import { useEffect, useRef } from 'preact/hooks';
import { bindVideo, nowPlaying, videoLayout } from '../data/playback.ts';

/** The single persistent <video>, positioned by `videoLayout` (preview box or full screen). */
export function VideoSurface() {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) bindVideo(ref.current);
  }, []);
  const l = videoLayout.value;
  let style = 'display:none';
  if (!nowPlaying.value) style = 'display:none';
  else if (l.mode === 'full') style = 'left:0;top:0;width:1920px;height:1080px';
  else if (l.mode === 'box') style = `left:${l.left}px;top:${l.top}px;width:${l.width}px;height:${l.height}px;border-radius:22px`;
  return <video ref={ref} class={'tv-video' + (l.mode === 'full' ? ' full' : '')} style={style} playsInline />;
}
