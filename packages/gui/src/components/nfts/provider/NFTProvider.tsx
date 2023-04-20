import { type NFTInfo, type Wallet } from '@chia-network/api';
import {
  useGetNFTWallets,
  useLazyGetNFTsQuery,
  useLazyGetNFTsCountQuery,
  useNFTCoinAdded,
  useGetLoggedInFingerprintQuery,
  useLazyGetNFTInfoQuery,
} from '@chia-network/api-react';
import { sortBy } from 'lodash';
import React, { useMemo, useCallback, useEffect, useRef, type ReactNode } from 'react';

import type Metadata from '../../../@types/Metadata';
import type NFTData from '../../../@types/NFTData';
import useCache from '../../../hooks/useCache';
import useStateAbort from '../../../hooks/useStateAbort';
import compareChecksums from '../../../util/compareChecksums';
import getNFTFileType from '../../../util/getNFTFileType';
import limit from '../../../util/limit';
import parseFileContent from '../../../util/parseFileContent';
import removeHexPrefix from '../../../util/removeHexPrefix';
import NFTProviderContext from './NFTProviderContext';

function parseMetadataFile(content: Buffer, headers: any) {
  const metadataString = parseFileContent(content, headers);

  return JSON.parse(metadataString) as Metadata;
}

type Change = {
  type: 'add' | 'remove';
  nftId: string;
};

export type NFTProviderProps = {
  children: ReactNode;
  pageSize?: number;
  concurrency?: number;
};

// private ongoingRequests: Map<string, Promise<Buffer>> = new Map();

export default function NFTProvider(props: NFTProviderProps) {
  const { children, pageSize = 12, concurrency = 5 } = props;

  const { data: fingerprint, isLoading: isLoadingFingerprint } = useGetLoggedInFingerprintQuery();

  // number of loaded NFTs
  const [loaded, setLoaded] = useStateAbort(0);
  // total number of NFTs
  const [total, setTotal] = useStateAbort(0);
  // list of NFTs
  const [nfts, setNFTs] = useStateAbort<NFTData[]>([]);
  const nftsRef = useRef(nfts);
  nftsRef.current = nfts;
  // status of loading
  const [isLoadingNFTs, setIsLoadingNFTs] = useStateAbort(false);
  const [error, setError] = useStateAbort<Error | undefined>(undefined);
  const cache = useCache();

  const [getNFTs] = useLazyGetNFTsQuery();
  const [getNFTsCount] = useLazyGetNFTsCountQuery();
  const { wallets: nftWallets, isLoading: isLoadingWallets } = useGetNFTWallets();

  // launcherId
  const [getNFTInfo] = useLazyGetNFTInfoQuery();

  const [, setChanges] = useStateAbort<Change[]>([]);

  // NFT profile counts in NFTProfileDropdown
  const [nftsCounts, setNftsCounts] = useStateAbort<Record<string, number>>({});

  const metadataAdd = limit(concurrency);

  useNFTCoinAdded((data) => {
    const { nftId } = data;

    setChanges((prevChanges) => [...prevChanges, { type: 'add', nftId }]);
  });

  async function fetchNFTsCount(walletId: number | undefined, signal?: AbortSignal) {
    const { total: count } = await getNFTsCount({
      walletIds: [walletId],
      signal,
    }).unwrap();

    setNftsCounts(Object.assign(nftsCounts, { [walletId || 0]: count }), signal); // 0 is the default wallet (All NFTs)

    return count;
  }

  async function fetchNFTsPage(walletId: number, pageIndex: number, signal: AbortSignal) {
    const startIndex = pageIndex * pageSize;
    const nftsByWallet = await getNFTs({
      walletIds: [walletId],
      startIndex,
      num: pageSize,
      signal,
    }).unwrap();

    if (signal?.aborted) {
      return;
    }

    const page = nftsByWallet[walletId];

    setNFTs((prevNfts) => {
      const nftsByIds = new Map(prevNfts.map((nftItem) => [nftItem.nft.$nftId, nftItem]));

      const newNFTs = [...prevNfts];

      // update existing NFTs
      page.forEach((nft: NFTInfo) => {
        const { $nftId: nftId } = nft;

        if (nftsByIds.has(nftId)) {
          const originalItem = nftsByIds.get(nftId);
          if (originalItem) {
            originalItem.nft = nft;
            originalItem.inList = true;
          }
        } else {
          newNFTs.push({
            inList: true,
            nft,
            coinId: removeHexPrefix(nft.launcherId),
            type: getNFTFileType(nft),
          });
        }
      });

      return sortBy(newNFTs, (nftItem) => nftItem.nft?.nftCoinConfirmationHeight);
    }, signal);

    setLoaded((prevLoaded) => prevLoaded + page.length, signal);

    // try to get metadata for each NFT without await (we can show data without metadata)
    page.map((nft: NFTInfo) => metadataAdd(() => fetchMetadata(nft, signal)));
  }

  async function updateNft(id: string, data: Partial<NFTData>, signal: AbortSignal) {
    setNFTs(
      (prevNfts) =>
        prevNfts.map((nftItem) => {
          if (nftItem.nft.$nftId === id) {
            return {
              ...nftItem,
              ...data,
            };
          }

          return nftItem;
        }),
      signal
    );
  }

  async function fetchAndProcessMetadata(uri: string, hash: string | undefined) {
    const { content, headers, checksum } = await cache.get(uri);

    if (hash && !compareChecksums(checksum, hash)) {
      throw new Error('Checksum mismatch');
    }

    return parseMetadataFile(content, headers);
  }

  async function fetchMetadata(nft: NFTInfo, signal: AbortSignal) {
    const { $nftId: nftId, metadataUris = [], metadataHash } = nft;

    try {
      const [firstUri] = metadataUris;
      if (!firstUri) {
        return undefined;
      }

      const existingNft = nfts.find((nftItem) => nftItem.nft.$nftId === nftId);
      if (existingNft?.metadataPromise) {
        return await existingNft.metadataPromise;
      }

      // todo add then
      const promise = fetchAndProcessMetadata(firstUri, metadataHash);

      updateNft(
        nftId,
        {
          metadata: undefined,
          metadataError: undefined,
          metadataPromise: promise,
        },
        signal
      );

      promise.then(
        (metadata) => {
          updateNft(
            nftId,
            {
              metadata,
              metadataPromise: undefined,
            },
            signal
          );
        },
        () => {
          updateNft(
            nftId,
            {
              metadataPromise: undefined,
            },
            signal
          );
        }
      );

      const metadata = await promise;

      updateNft(
        nftId,
        {
          metadata,
          metadataPromise: undefined,
        },
        signal
      );

      return metadata;
    } catch (err) {
      updateNft(
        nftId,
        {
          metadataError: err as Error,
          metadataPromise: undefined,
        },
        signal
      );

      return undefined;
    }
  }

  const invalidate = useCallback(
    async (nftId: string) => {
      const item = nftsRef.current.find((nftItem) => nftItem.nft.$nftId === nftId);
      if (!item) {
        return;
      }

      const { nft, metadataPromise } = item;
      const { dataUris, metadataUris } = nft;

      // wait for old request to finish
      if (metadataPromise) {
        await metadataPromise;
      }

      const promises = dataUris.map((uri) => cache.invalidate(uri));

      const firstMetadataUri = metadataUris && metadataUris[0];
      if (firstMetadataUri) {
        promises.push(cache.invalidate(firstMetadataUri));
      }

      try {
        const metadata = item.metadata ?? item.metadataPromise ? await item.metadataPromise : item.metadata;
        if (metadata) {
          // invalidate all previews
          const { preview_video_uris: previewVideoUris, preview_image_uris: previewImageUris } = nftMetadata;

          if (previewVideoUris) {
            previewVideoUris.forEach((uri: string) => promises.push(cache.invalidate(uri)));
          }

          if (previewImageUris) {
            previewImageUris.forEach((uri: string) => promises.push(cache.invalidate(uri)));
          }
        }
      } finally {
        await Promise.all(promises);
      }
    },
    [cache, nftsRef]
  );

  async function fetchData(options: { signal: AbortSignal }) {
    const { signal } = options;
    if (isLoadingNFTs) {
      return;
    }

    setIsLoadingNFTs(true, signal);
    setError(undefined, signal);
    setChanges([], signal);

    const add = limit(concurrency);

    async function processWallet(wallet: Wallet) {
      const { id: walletId } = wallet;
      const count = await fetchNFTsCount(walletId, signal);
      if (signal?.aborted) {
        return;
      }

      setTotal((prevTotal) => prevTotal + count, signal);
      const numPages = Math.ceil(count / pageSize);

      const fetchLimited = (pageIndex: number) => add(() => fetchNFTsPage(walletId, pageIndex, signal));

      const pageIndices = [];
      for (let i = 0; i < numPages; i++) {
        pageIndices.push(i);
      }

      try {
        await Promise.all(pageIndices.map(fetchLimited));
      } catch (err) {
        if (signal?.aborted) {
          return;
        }

        setError(err as Error, signal);
      }
    }

    try {
      await fetchNFTsCount(undefined, signal);
      await Promise.all(nftWallets.map(processWallet));
    } catch (err) {
      setError(err as Error, signal);
    } finally {
      setIsLoadingNFTs(false, signal);
    }

    // if changes changed while we were fetching, fetch again
    setChanges((prevChanges) => {
      if (prevChanges.length > 0) {
        return prevChanges;
      }

      return [];
    }, signal);
  }

  function reset() {
    setChanges([]);
    setNFTs([]);
    setTotal(0);
    setLoaded(0);
    setIsLoadingNFTs(false);
    setError(undefined);
  }

  const getByCoinId = useCallback(
    async (coinId: string) => {
      const item = nftsRef.current.find((nftData) => nftData.coinId === coinId);
      if (item) {
        return item.nftPromise ? item.nftPromise : item.nft;
      }

      const promise = getNFTInfo({
        coinId,
      }).unwrap();

      setNFTs((prevNfts) => [
        ...prevNfts,
        {
          coinId,
          nftPromise: promise,
        },
      ]);

      return promise.then(
        (nft: NFTInfo) => {
          setNFTs((prevNfts) => {
            const newPrevNfts = [...prevNfts];
            // immutable update by coinId
            const index = newPrevNfts.findIndex((nftItem) => nftItem.coinId === coinId);
            if (index !== -1) {
              const current = newPrevNfts[index];

              newPrevNfts[index] = {
                ...current,
                nft,
                type: getNFTFileType(nft),
                nftPromise: undefined,
              };
            }

            return newPrevNfts;
          });

          return nft;
        },
        (e: Error) => {
          setNFTs((prevNfts) => {
            const newPrevNfts = [...prevNfts];
            // immutable update by coinId
            const index = newPrevNfts.findIndex((nftItem) => nftItem.coinId === coinId);
            if (index !== -1) {
              const current = newPrevNfts[index];
              // updated from different service
              if (current.nft) {
                newPrevNfts[index] = {
                  ...current,
                  nftPromise: undefined,
                  nftError: undefined,
                };
              } else {
                newPrevNfts[index] = {
                  ...current,
                  nftPromise: undefined,
                  nftError: e,
                };
              }
            }

            return newPrevNfts;
          });

          return undefined;
        }
      );
    },
    [setNFTs, getNFTInfo, nftsRef]
  );

  useEffect(() => {
    if (!isLoadingWallets && nftWallets && fingerprint) {
      const abortController = new AbortController();
      fetchData({
        signal: abortController.signal,
      });

      return () => {
        abortController.abort();
        reset();
      };
    }

    return undefined;
  }, [isLoadingWallets, nftWallets, fingerprint]); // eslint-disable-line react-hooks/exhaustive-deps -- we want to fetch data only once

  const isLoading = isLoadingNFTs || isLoadingFingerprint || isLoadingWallets;

  const context = useMemo(
    () => ({
      nfts,
      count: total,
      loaded,
      isLoading,
      error,
      progress: total > 0 ? (loaded / total) * 100 : 0,
      invalidate,
      getByCoinId,
      nftsCounts,
    }),
    [nfts, total, loaded, isLoading, error, invalidate, getByCoinId, nftsCounts]
  );

  return <NFTProviderContext.Provider value={context}>{children}</NFTProviderContext.Provider>;
}
