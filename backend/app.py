from flask import Flask, request, jsonify, send_from_directory, make_response
from flask_pymongo import PyMongo
import subprocess
import signal
import os
import time
import threading

app = Flask(__name__)
from flask_cors import CORS
CORS(app, resources={r"/*": {"origins": "*"}}, supports_credentials=True)

app.config["MONGO_URI"] = "mongodb://localhost:27017/myDatabase"
mongo = PyMongo(app)

ffmpeg_process = None
Hsl_directory = os.path.join(os.getcwd(),"hls")
if not os.path.exists(Hsl_directory):
    os.mkdir(Hsl_directory)

def monitor_ffmpeg(process):
    """Monitor FFmpeg process and log output"""
    while process.poll() is None:
        output = process.stderr.readline()
        if output:
            print(f"FFmpeg: {output.decode('utf-8').strip()}")
    print("FFmpeg process ended")

def cleanup_hls_files():
    """Clean up all HLS files in the directory"""
    try:
        for f in os.listdir(Hsl_directory):
            file_path = os.path.join(Hsl_directory, f)
            if f.endswith('.ts') or f.endswith('.m3u8'):
                try:
                    os.remove(file_path)
                    print(f"Deleted: {f}")
                except Exception as e:
                    print(f"Error deleting {f}: {e}")
        print("HLS directory cleaned")
    except Exception as e:
        print(f"Error cleaning HLS directory: {e}")

@app.route("/stream_start",methods=["POST"])
def stream_start():
    global ffmpeg_process
    data = request.get_json()
    rtsp_url = data.get("rtsp_url")
    if not rtsp_url:
        return jsonify({"error":"RTSP url is required"}),400
    
    # Stop existing stream if running
    if ffmpeg_process:
        try:
            print("Stopping existing FFmpeg process...")
            os.killpg(os.getpgid(ffmpeg_process.pid), signal.SIGTERM)
            ffmpeg_process.wait(timeout=3)
        except Exception as e:
            print(f"Error stopping existing stream: {e}")
            try:
                ffmpeg_process.kill()
            except:
                pass
        finally:
            ffmpeg_process = None
    
    # CRITICAL: Clean up ALL old segments before starting new stream
    print("Cleaning up old segments...")
    cleanup_hls_files()
    time.sleep(0.5)  # Give filesystem time to complete deletion
    
    cmd=[
        "ffmpeg",
        "-rtsp_transport", "tcp",
        "-analyzeduration", "5000000",
        "-probesize", "5000000",
        "-fflags", "nobuffer",
        "-flags", "low_delay",
        "-strict", "experimental",
        "-i", rtsp_url,
        "-vsync", "1",
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-tune", "zerolatency",
        "-b:v", "2000k",
        "-maxrate", "2000k",
        "-bufsize", "4000k",
        "-g", "60",
        "-keyint_min", "60",
        "-sc_threshold", "0",
        "-r", "30",
        "-c:a", "aac",
        "-b:a", "128k",
        "-ar", "44100",
        "-f", "hls",
        "-hls_time", "2",
        "-hls_list_size", "5",  # Keep only 5 segments to prevent looping
        "-hls_flags", "delete_segments+omit_endlist+program_date_time",
        "-hls_segment_type", "mpegts",
        "-hls_segment_filename", os.path.join(Hsl_directory, "segment_%05d.ts"),
        "-start_number", "0",
        "-hls_allow_cache", "0",
        "-hls_delete_threshold", "1",  # Delete segments immediately after they're out of playlist
        os.path.join(Hsl_directory, "stream.m3u8")
    ]
    
    try:
        print(f"Starting FFmpeg with RTSP URL: {rtsp_url}")
        ffmpeg_process = subprocess.Popen(
            cmd, 
            preexec_fn=os.setsid, 
            stdout=subprocess.PIPE, 
            stderr=subprocess.PIPE,
            universal_newlines=False
        )
        
        # Start monitoring thread
        monitor_thread = threading.Thread(target=monitor_ffmpeg, args=(ffmpeg_process,))
        monitor_thread.daemon = True
        monitor_thread.start()
        
        # Wait for FFmpeg to start generating segments
        time.sleep(18)
        
        # Check if m3u8 file was created
        m3u8_path = os.path.join(Hsl_directory, "stream.m3u8")
        if not os.path.exists(m3u8_path):
            raise Exception("Failed to generate HLS playlist")
        
        # Use timestamp to force cache busting on client side
        stream_url = request.host_url.rstrip('/') + f'/hls/stream.m3u8?t={int(time.time())}'
        print(f"Stream started successfully: {stream_url}")
        return jsonify({"message": "Stream started", "stream_url": stream_url})
    except Exception as e:
        print(f"Error starting stream: {e}")
        if ffmpeg_process:
            try:
                os.killpg(os.getpgid(ffmpeg_process.pid), signal.SIGTERM)
            except:
                pass
            ffmpeg_process = None
        return jsonify({"error": f"Failed to start stream: {str(e)}"}), 500

@app.route("/stream_stop",methods=["POST"])
def stream_stop():
    global ffmpeg_process
    if ffmpeg_process:
        try:
            print("Stopping stream...")
            os.killpg(os.getpgid(ffmpeg_process.pid),signal.SIGTERM)
            ffmpeg_process.wait(timeout=5)
        except Exception as e:
            print(f"Error stopping stream: {e}")
            try:
                ffmpeg_process.kill()
            except:
                pass
        finally:
            ffmpeg_process = None
        
        # Clean up HLS files after stopping
        time.sleep(0.5)
        cleanup_hls_files()
        
        return jsonify({"message":"Stream Stopped"})
    return jsonify({"error":"no stream running"}),400    

@app.route("/hls/<path:filename>")
def serve_hls(filename):
    try:
        response = send_from_directory(Hsl_directory, filename)
        # Aggressive cache prevention
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate, max-age=0'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Access-Control-Expose-Headers'] = 'Content-Length, Content-Type'
        
        if filename.endswith('.m3u8'):
            response.headers['Content-Type'] = 'application/vnd.apple.mpegurl'
        elif filename.endswith('.ts'):
            response.headers['Content-Type'] = 'video/mp2t'
            
        return response
    except Exception as e:
        print(f"Error serving file {filename}: {e}")
        return jsonify({"error": "File not found"}), 404

@app.route("/")
def hello_world():
    return "<p>Hello, World!</p>"

if __name__ == '__main__':
    app.run(debug=True, threaded=True, host='0.0.0.0')