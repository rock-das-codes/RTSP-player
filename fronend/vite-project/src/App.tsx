import { useState, useEffect, useRef } from 'react'
import './App.css'
import Hls from "hls.js";

function VideoPlayer({ streamUrl, onError }: { streamUrl: string, onError: (error: string) => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  useEffect(() => {
    // Cleanup function to destroy previous instance
    const cleanup = () => {
      if (hlsRef.current) {
        console.log("🧹 Destroying previous HLS instance");
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.src = '';
        videoRef.current.load();
      }
    };

    // Clean up any existing instance first
    cleanup();

    if (videoRef.current && streamUrl) {
      if (Hls.isSupported()) {
        console.log("🎬 Initializing new HLS player for:", streamUrl);
        
        const hls = new Hls({
          debug: false,  // Set to true for more logs
          enableWorker: true,
          lowLatencyMode: true,
          
          // Buffering configuration
          maxBufferLength: 10,
          maxMaxBufferLength: 30,
          maxBufferSize: 60 * 1000 * 1000,
          maxBufferHole: 0.5,
          
          // Live stream specific settings
          liveSyncDurationCount: 3,
          liveMaxLatencyDurationCount: 10,
          liveDurationInfinity: true,
          
          // Fragment loading settings
          manifestLoadingTimeOut: 10000,
          manifestLoadingMaxRetry: 10,
          manifestLoadingRetryDelay: 1000,
          
          levelLoadingTimeOut: 10000,
          levelLoadingMaxRetry: 10,
          levelLoadingRetryDelay: 1000,
          
          fragLoadingTimeOut: 20000,
          fragLoadingMaxRetry: 10,
          fragLoadingRetryDelay: 1000,
          
          // Stall detection and recovery
          highBufferWatchdogPeriod: 1,
          nudgeOffset: 0.1,
          nudgeMaxRetry: 5,
          
          // Start from live edge
          startPosition: -1,
          
          // Prevent loading old segments
          backBufferLength: 10,
        });

        hlsRef.current = hls;
        
        hls.loadSource(streamUrl);
        hls.attachMedia(videoRef.current);
        
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          console.log("✓ Manifest parsed, starting playback");
          videoRef.current?.play()
            .then(() => console.log("✓ Playback started"))
            .catch(e => {
              console.error("✗ Play error:", e);
              onError("Failed to start playback. Click the play button.");
            });
        });

        hls.on(Hls.Events.FRAG_LOADED, (event, data) => {
          console.log(`✓ Fragment ${data.frag.sn} loaded`);
        });

        hls.on(Hls.Events.ERROR, (event, data) => {
          console.error("HLS Error:", {
            type: data.type,
            details: data.details,
            fatal: data.fatal
          });
          
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                console.log("⟳ Network error - attempting recovery");
                setTimeout(() => {
                  if (hlsRef.current) {
                    hls.startLoad();
                  }
                }, 1000);
                break;
                
              case Hls.ErrorTypes.MEDIA_ERROR:
                console.log("⟳ Media error - attempting recovery");
                hls.recoverMediaError();
                break;
                
              default:
                console.log("✗ Fatal error - cannot recover");
                onError("Stream error: " + data.details);
                break;
            }
          } else {
            if (data.details === 'bufferStalledError') {
              console.log("⟳ Buffer stalled - seeking to live edge");
              if (videoRef.current && hls.liveSyncPosition) {
                videoRef.current.currentTime = hls.liveSyncPosition;
              }
            }
          }
        });

        // Monitor playback for issues
        const handleStalled = () => {
          console.log("⚠ Video stalled - recovering");
          if (videoRef.current && hlsRef.current && hlsRef.current.liveSyncPosition) {
            videoRef.current.currentTime = hlsRef.current.liveSyncPosition;
          }
        };

        videoRef.current.addEventListener('stalled', handleStalled);

        // Return cleanup function
        return () => {
          videoRef.current?.removeEventListener('stalled', handleStalled);
          cleanup();
        };
        
      } else if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
        console.log("Using native HLS support");
        videoRef.current.src = streamUrl;
        videoRef.current.play().catch(e => {
          console.error("Play error:", e);
          onError("Failed to start playback");
        });
        
        return cleanup;
      }
    }
    
    return cleanup;
  }, [streamUrl, onError]);

  return (
    <video 
      ref={videoRef} 
      controls 
      autoPlay 
      muted
      playsInline
      style={{ 
        width: "100%", 
        marginTop: "1rem", 
        backgroundColor: "#000",
        maxHeight: "70vh"
      }} 
    />
  );
}

function App() {
  const [url, setUrl] = useState("");
  const [streamUrl, setStreamUrl] = useState("");
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const startStream = async () => {
    try {
      setError("");
      setLoading(true);
      
      // If there's an existing stream, stop it first
      if (playing) {
        console.log("Stopping existing stream before starting new one...");
        await stopStream();
        // Wait a bit for cleanup
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      console.log("Starting stream with URL:", url);
      const res = await fetch("http://127.0.0.1:5000/stream_start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rtsp_url: url }),
      });
      
      if (!res.ok) {
        throw new Error(`Server error: ${res.status}`);
      }
      
      const data = await res.json();
      
      if (data.stream_url) {
        console.log("Stream URL received:", data.stream_url);
        // Wait for FFmpeg to generate initial segments
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Set new stream URL with timestamp to force reload
        setStreamUrl(data.stream_url);
        setPlaying(true);
        setLoading(false);
      } else if (data.error) {
        setError(data.error);
        setLoading(false);
      }
    } catch (err) {
      setError("Failed to start stream: " + (err as Error).message);
      setLoading(false);
      console.error(err);
    }
  };

  const stopStream = async () => {
    try {
      console.log("Stopping stream...");
      
      // Clear the stream URL first to unmount the video player
      setStreamUrl("");
      setPlaying(false);
      
      // Wait a moment for the component to unmount
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Then tell the backend to stop
      await fetch("http://127.0.0.1:5000/stream_stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      
      console.log("Stream stopped");
    } catch (err) {
      console.error("Failed to stop stream:", err);
      // Still update UI even if backend call fails
      setStreamUrl("");
      setPlaying(false);
    }
  };

  const handleVideoError = (errorMsg: string) => {
    setError(errorMsg);
  };

  return (
    <div style={{ padding: "2rem", maxWidth: "1200px", margin: "0 auto" }}>
      <h1>RTSP Stream Player</h1>
      <div style={{ marginBottom: "1rem" }}>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Enter RTSP URL (e.g., rtsp://...)"
          className="border p-2 w-1/2"
          style={{ padding: "0.5rem", fontSize: "1rem" }}
        />
        {!playing && !loading && (
          <button 
            onClick={startStream} 
            className="ml-2 px-4 py-2 bg-blue-500 text-white rounded"
            disabled={!url}
            style={{ 
              marginLeft: "0.5rem", 
              padding: "0.5rem 1rem",
              opacity: !url ? 0.5 : 1,
              cursor: !url ? 'not-allowed' : 'pointer'
            }}
          >
            Start Stream
          </button>
        )}
        {loading && (
          <span className="ml-2" style={{ marginLeft: "0.5rem" }}>
            Starting stream...
          </span>
        )}
        {playing && (
          <>
            <button
              onClick={stopStream}
              className="ml-2 px-4 py-2 bg-red-500 text-white rounded"
              style={{ marginLeft: "0.5rem", padding: "0.5rem 1rem" }}
            >
              Stop Stream
            </button>
            <button
              onClick={() => {
                stopStream().then(() => {
                  setTimeout(startStream, 1000);
                });
              }}
              className="ml-2 px-4 py-2 bg-green-500 text-white rounded"
              style={{ marginLeft: "0.5rem", padding: "0.5rem 1rem" }}
            >
              Restart Stream
            </button>
          </>
        )}
      </div>
      {error && (
        <div style={{ 
          color: 'white', 
          backgroundColor: '#dc2626',
          marginTop: '1rem', 
          padding: '1rem', 
          borderRadius: '4px' 
        }}>
          ⚠ {error}
        </div>
      )}
      {playing && streamUrl && (
        <VideoPlayer 
          key={streamUrl} // Force remount when URL changes
          streamUrl={streamUrl} 
          onError={handleVideoError}
        />
      )}
    </div>
  );
}

export default App