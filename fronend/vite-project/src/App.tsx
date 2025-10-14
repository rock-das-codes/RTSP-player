import { useState,useEffect } from 'react'

import './App.css'

import Hls from "hls.js";

import { useRef } from 'react';

function VideoPlayer({ streamUrl }: { streamUrl: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (videoRef.current && streamUrl) {
      if (Hls.isSupported()) {
        console.log("supported hsl")
        const hls = new Hls();
        hls.loadSource(streamUrl);
        hls.attachMedia(videoRef.current);
        return () => hls.destroy();
      } else if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
        videoRef.current.src = streamUrl;
      }
    }
  }, [streamUrl]);

  return <video ref={videoRef} controls autoPlay style={{ width: "100%", marginTop: "1rem" }} />;
}
function App() {
  const [url, setUrl] = useState("");
  const [streamUrl, setStreamUrl] = useState("");
  const [playing, setPlaying] = useState(false);

  const startStream = async () => {
    const res = await fetch("https://fantastic-space-pancake-4947pw6w774h5jw-5000.app.github.dev/stream_start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rtsp_url: url }),
    });
    const data = await res.json();
    if (data.stream_url) {
      setStreamUrl(data.stream_url);
      setPlaying(true);
    }
  };

  return (
    <div>
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="Enter RTSP URL"
        className="border p-2 w-1/2"
      />
      {!playing && (
        <button onClick={startStream} className="ml-2 px-4 py-2 bg-blue-500 text-white rounded">
          Start Stream
        </button>
      )}
      {playing && (
        <>
          <button
            onClick={async () => {
              await fetch("https://fantastic-space-pancake-4947pw6w774h5jw-5000.app.github.dev/stream_stop", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
              });
              setPlaying(false);
              setStreamUrl("");
            }}
            className="ml-2 px-4 py-2 bg-red-500 text-white rounded"
          >
            Stop Stream
          </button>
          <VideoPlayer streamUrl={streamUrl} />
        </>
      )}
    </div>
  );
}
export default App
