import React, {
  useMemo,
  useState,
  useRef,
  type ReactNode,
  Fragment,
  useEffect,
} from 'react';
import { renderToString } from 'react-dom/server';
import mime from 'mime-types';
import { t, Trans } from '@lingui/macro';
import { Box, Button } from '@mui/material';
import { NotInterested, Error as ErrorIcon } from '@mui/icons-material';

import {
  IconMessage,
  Loading,
  Flex,
  SandboxedIframe,
  usePersistState,
  useDarkMode,
} from '@chia/core';
import styled from 'styled-components';
import { type NFTInfo } from '@chia/api';
import isURL from 'validator/lib/isURL';
import useNFTHash from '../../hooks/useNFTHash';
import AudioSvg from '../../assets/img/audio.svg';
import AudioPngIcon from '../../assets/img/audio.png';
import UnknownPngIcon from '../../assets/img/unknown.png';
import DocumentPngIcon from '../../assets/img/document.png';
import VideoPngIcon from '../../assets/img/video.png';
import ModelPngIcon from '../../assets/img/model.png';
import AudioPngDarkIcon from '../../assets/img/audio_dark.png';
import UnknownPngDarkIcon from '../../assets/img/unknown_dark.png';
import DocumentPngDarkIcon from '../../assets/img/document_dark.png';
import VideoPngDarkIcon from '../../assets/img/video_dark.png';
import ModelPngDarkIcon from '../../assets/img/model_dark.png';

function prepareErrorMessage(error: string | undefined): ReactNode {
  if (error === 'Response too large') {
    return <Trans>File is over 10MB</Trans>;
  }
  return error;
}

const StyledCardPreview = styled(Box)`
  height: ${({ height }) => height};
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  overflow: hidden;
`;

const ThumbnailError = styled.div`
  color: red;
  text-align: center;
`;

const AudioWrapper = styled.div`
  width: 100%;
  height: 100%;
  background-image: url(${(props) =>
    props.albumArt ? props.albumArt : 'none'});
  background-position: center;
  display: flex;
  align-items: center;
  justify-content: center;
  > audio + svg {
    margin-top: 20px;
  }
  audio {
    position: absolute;
    margin-left: auto;
    margin-right: auto;
    left: 0;
    right: 0;
    bottom: 20px;
    text-align: center;
    // box-shadow: 0 3px 15px #000;
    border-radius: 30px;
  }
  img {
    width: 144px;
    height: 144px;
  }
`;

const AudioIconWrapper = styled.div`
  position: absolute;
  bottom: 20px;
  left: 0;
  background: #fff;
  width: 54px;
  height: 54px;
  border-radius: 30px;
  background: #f4f4f4;
  text-align: center;
  margin-left: auto;
  margin-right: auto;
  right: 247px;
  line-height: 66px;
  transition: right 0.25s linear, width 0.25s linear, opacity 0.25s;
  visibility: visible;
  display: ${(props) => (props.isPreview ? 'inline-block' : 'none')};
  &.transition {
    width: 300px;
    right: 0px;
    transition: right 0.25s linear, width 0.25s linear;
  }
  &.hide {
    visibility: hidden;
  }
`;

const AudioIcon = styled(AudioSvg)``;

const IframeWrapper = styled.div`
  padding: 0;
  margin: 0;
  height: 100%;
  width: 100%;
  position: relative;
`;

const IframePreventEvents = styled.div`
  position: absolute;
  height: 100%;
  width: 100%;
  z-index: 2;
`;

const ModelExtension = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 8px 16px;
  background: ${(props) => (props.isDarkMode ? '#333' : '#fff')};
  box-shadow: 0px 0px 24px rgba(24, 162, 61, 0.5),
    0px 4px 8px rgba(18, 99, 60, 0.32);
  border-radius: 32px;
  color: ${(props) => (props.isDarkMode ? '#fff' : '#333')};
`;

const AudioControls = styled.div`
  visibility: ${(props) => (props.isPreview ? 'hidden' : 'visible')};
  &.transition {
    visibility: visible;
  }
`;

export type NFTPreviewProps = {
  nft: NFTInfo;
  height?: number | string;
  width?: number | string;
  fit?: 'cover' | 'contain' | 'fill';
  elevate?: boolean;
  background?: any;
  hideStatusBar?: boolean;
  isPreview?: boolean;
};

let loopImageInterval: any;
let isPlaying: boolean = false;

export default function NFTPreview(props: NFTPreviewProps) {
  const {
    nft,
    nft: { dataUris },
    height = '300px',
    width = '100%',
    fit = 'cover',
    background: Background = Fragment,
    hideStatusBar = false,
    isPreview = false,
  } = props;

  const hasFile = dataUris?.length > 0;
  const file = dataUris?.[0];
  const extension: string = new URL(file).pathname.split('.').slice(-1)[0];

  const [loaded, setLoaded] = useState(false);
  const { isValid, isLoading, error, thumbnail } = useNFTHash(nft, isPreview);

  const [ignoreError, setIgnoreError] = usePersistState<boolean>(
    false,
    `nft-preview-ignore-error-${nft.$nftId}-${file}`,
  );

  const iframeRef = useRef<any>(null);
  const audioIconRef = useRef<any>(null);
  const audioControlsRef = useRef<any>(null);

  const isUrlValid = useMemo(() => {
    if (!file) {
      return false;
    }

    return isURL(file);
  }, [file]);

  const [statusText, isStatusError] = useMemo(() => {
    if (nft.pendingTransaction) {
      return [t`Update Pending`, false];
    } else if (error === 'Hash mismatch') {
      return [t`Image Hash Mismatch`, true];
    }
    return [undefined, false];
  }, [nft, isValid, error]);

  const { isDarkMode } = useDarkMode();

  const srcDoc = useMemo(() => {
    if (!file) {
      return;
    }

    const hideVideoCss = isPreview
      ? `
      video::-webkit-media-controls {
        display: none !important;
      }   
    `
      : '';

    const style = `
      html, body {
        border: 0px;
        margin: 0px;
        padding: 0px;
        height: 100%;
        width: 100%;
        text-align: center;
      }

      img {
        object-fit: ${fit};
      }

      #status-container {
        display: flex;
        flex-direction: row;
        justify-content: center;
        align-items: center;
        position: absolute;
        top: 0;
        width: 100%;
      }

      #status-pill {
        background-color: rgba(255, 255, 255, 0.4);
        backdrop-filter: blur(6px);
        border: 1px solid rgba(255, 255, 255, 0.13);
        border-radius: 16px;
        box-sizing: border-box;
        box-shadow: 0px 4px 4px rgba(0, 0, 0, 0.25);
        display: flex;
        height: 30px;
        margin-top: 20px;
        padding: 8px 20px;
      }

      #status-text {
        font-family: 'Roboto', sans-serif;
        font-style: normal;
        font-weight: 500;
        font-size: 12px;
        line-height: 14px;
      }
      audio {
        margin-top: 140px;
      }     
      ${hideVideoCss}
    `;

    let mediaElement = null;

    if (thumbnail.video) {
      mediaElement = (
        <video width="100%" height="100%">
          <source src={thumbnail.video} />
        </video>
      );
    } else if (thumbnail.image) {
      mediaElement = (
        <img
          src={thumbnail.image}
          alt={t`Preview`}
          width="100%"
          height="100%"
        />
      );
    } else if (mimeType().match(/^audio/)) {
      mediaElement = (
        <>
          <audio controls>
            <source src={file} />
          </audio>
        </>
      );
    } else if (mimeType().match(/^video/)) {
      mediaElement = (
        <video width="100%" height="100%">
          <source src={file} />
        </video>
      );
    } else {
      mediaElement = (
        <img src={file} alt={t`Preview`} width="100%" height="100%" />
      );
    }

    return renderToString(
      <html>
        <head>
          <style dangerouslySetInnerHTML={{ __html: style }} />
        </head>
        <body>
          {mediaElement}
          {statusText && !hideStatusBar && (
            <div id="status-container">
              <div id="status-pill">
                <span id="status-text">{statusText}</span>
              </div>
            </div>
          )}
        </body>
      </html>,
    );
  }, [file, statusText, isStatusError, thumbnail, error]);

  function mimeType() {
    const pathName: string = new URL(file).pathname;
    return mime.lookup(pathName);
  }

  function getVideoDOM() {
    const iframe =
      iframeRef.current && iframeRef.current.querySelector('iframe');
    if (iframe) {
      return iframe.contentWindow.document.querySelector('video');
    }
    return null;
  }

  function stopVideo() {
    const video = getVideoDOM();
    if (video) {
      video.controls = false;
      video.pause();
    }
  }

  function hideVideoControls() {
    const video = getVideoDOM();
    if (video) {
      video.controls = false;
      video.removeAttribute('controls');
      video.playsInline = true;
    }
  }

  function handleLoadedChange(loadedValue: any) {
    setLoaded(loadedValue);
    if (thumbnail.video) {
      hideVideoControls();
    }
  }

  function handleIgnoreError(event: any) {
    event.stopPropagation();

    setIgnoreError(true);
  }

  function renderAudioTag() {
    return (
      <AudioControls ref={audioControlsRef} isPreview={isPreview}>
        <audio controls>
          <source src={file} />
        </audio>
      </AudioControls>
    );
  }

  function renderAudioIcon() {
    return (
      <AudioIconWrapper ref={audioIconRef} isPreview={isPreview}>
        <AudioIcon />
      </AudioIconWrapper>
    );
  }

  function audioMouseEnter(e: any) {
    if (!isPreview) return;
    if (!isPlaying) {
      if (audioIconRef.current)
        audioIconRef.current.classList.add('transition');
      setTimeout(() => {
        if (audioControlsRef.current)
          audioControlsRef.current.classList.add('transition');
        if (audioIconRef.current) audioIconRef.current.classList.add('hide');
      }, 250);
    }
  }

  function audioMouseLeave(e: any) {
    if (!isPreview) return;
    if (!isPlaying) {
      if (audioIconRef.current) {
        audioIconRef.current.classList.remove('transition');
        audioIconRef.current.classList.remove('hide');
      }
      if (audioControlsRef.current) {
        audioControlsRef.current.classList.remove('transition');
      }
    }
  }

  function audioPlayEvent(e: any) {
    isPlaying = true;
  }

  function audioPauseEvent(e: any) {
    isPlaying = false;
  }

  function iframeMouseEnter(e: any) {
    e.stopPropagation();
    e.preventDefault();
    const videoDOM = getVideoDOM();
    if (isPreview && thumbnail.video && videoDOM) {
      videoDOM.play();
    }
  }

  function iframeMouseLeave() {
    if (isPreview && thumbnail.video) {
      stopVideo();
    }
    if (thumbnail.images) {
      clearTimeout(loopImageInterval);
    }
  }

  function isDocument() {
    return (
      [
        'pdf',
        'docx',
        'doc',
        'xls',
        'xlsx',
        'ppt',
        'pptx',
        'txt',
        'rtf',
      ].indexOf(extension) > -1
    );
  }

  function renderNftIcon() {
    if (isDocument()) {
      return <img src={isDarkMode ? DocumentPngDarkIcon : DocumentPngIcon} />;
    } else if (mimeType().match(/^model/)) {
      return <img src={isDarkMode ? ModelPngDarkIcon : ModelPngIcon} />;
    } else if (mimeType().match(/^video/)) {
      return <img src={isDarkMode ? VideoPngDarkIcon : VideoPngIcon} />;
    } else {
      return <img src={isDarkMode ? UnknownPngDarkIcon : UnknownPngIcon} />;
    }
  }

  function renderElementPreview() {
    if (
      (!mimeType().match(/^image/) &&
        !thumbnail.video &&
        !thumbnail.image &&
        !mimeType().match(/^audio/) &&
        isPreview) ||
      (!isPreview && (mimeType().match(/^model/) || isDocument()))
    ) {
      return (
        <>
          {renderNftIcon()}
          <ModelExtension isDarkMode={isDarkMode}>.{extension}</ModelExtension>
        </>
      );
    }

    if (mimeType().match(/^audio/)) {
      return (
        <AudioWrapper
          onMouseEnter={audioMouseEnter}
          onMouseLeave={audioMouseLeave}
          onPlay={audioPlayEvent}
          onPause={audioPauseEvent}
          albumArt={thumbnail.image}
        >
          {!thumbnail.image && <img src={AudioPngIcon} />}
          {renderAudioTag()}
          {renderAudioIcon()}
        </AudioWrapper>
      );
    }

    return (
      <IframeWrapper
        ref={iframeRef}
        onMouseEnter={iframeMouseEnter}
        onMouseLeave={iframeMouseLeave}
      >
        {isPreview && <IframePreventEvents />}
        <SandboxedIframe
          srcDoc={srcDoc}
          height={height}
          onLoadedChange={handleLoadedChange}
          hideUntilLoaded
        />
      </IframeWrapper>
    );
  }

  return (
    <StyledCardPreview height={height} width={width}>
      {!hasFile ? (
        <Background>
          <IconMessage icon={<NotInterested fontSize="large" />}>
            <Trans>No file available</Trans>
          </IconMessage>
        </Background>
      ) : !isUrlValid ? (
        <Background>
          <IconMessage icon={<ErrorIcon fontSize="large" />}>
            <Trans>Preview URL is not valid</Trans>
          </IconMessage>
        </Background>
      ) : error === 'missing preview_video_hash' ? (
        <ThumbnailError>
          <Trans>Missing preview_video_hash key</Trans>
        </ThumbnailError>
      ) : error === 'missing preview_image_hash' ? (
        <ThumbnailError>
          <Trans>Missing preview_image_hash key</Trans>
        </ThumbnailError>
      ) : error === 'failed fetch content' ? (
        <ThumbnailError>
          <Trans>Error fetching video preview</Trans>
        </ThumbnailError>
      ) : error === 'thumbnail hash mismatch' ? (
        <ThumbnailError>
          <Trans>Thumbnail hash mismatch</Trans>
        </ThumbnailError>
      ) : error === 'Error parsing json' ? (
        <ThumbnailError>
          <Trans>Error parsing json</Trans>
        </ThumbnailError>
      ) : isLoading ? (
        <Background>
          <Loading center>
            <Trans>Loading preview...</Trans>
          </Loading>
        </Background>
      ) : error && !isStatusError && !ignoreError ? (
        <Background>
          <Flex direction="column" gap={2}>
            <IconMessage icon={<ErrorIcon fontSize="large" />}>
              {prepareErrorMessage(error)}
            </IconMessage>
            <Button
              onClick={handleIgnoreError}
              variant="outlined"
              size="small"
              color="secondary"
            >
              <Trans>Show Preview</Trans>
            </Button>
          </Flex>
        </Background>
      ) : (
        <>
          {!loaded && Object.keys(thumbnail).length === 0 && (
            <Flex
              position="absolute"
              left="0"
              top="0"
              bottom="0"
              right="0"
              justifyContent="center"
              alignItems="center"
            >
              <Loading center>
                <Trans>Loading preview...</Trans>
              </Loading>
            </Flex>
          )}
          {renderElementPreview()}
        </>
      )}
    </StyledCardPreview>
  );
}
