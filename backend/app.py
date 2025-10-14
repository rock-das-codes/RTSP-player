from flask import Flask, request, jsonify, send_from_directory
from flask_pymongo import PyMongo
import subprocess
import signal
import os


app = Flask(__name__)

from flask_cors import CORS
CORS(app, resources={r"/*": {"origins": "*"}}, supports_credentials=True)
app.config["MONGO_URI"] = "mongodb://localhost:27017/myDatabase"
mongo = PyMongo(app)

ffmpeg_process = None

Hsl_directory = os.path.join(os.getcwd(),"hls")

if not os.path.exists(Hsl_directory):
    os.mkdir(Hsl_directory)

@app.route("/stream_start",methods=["POST"])
def stream_start():
    global ffmpeg_process
    data = request.get_json()
    rtsp_url = data.get("rtsp_url")

    if not rtsp_url:
        return jsonify({"error":"RTSP url is required"}),400
    
    if ffmpeg_process:
        os.killpg(os.getpgid(ffmpeg_process.pid), signal.SIGTERM)
    cmd=[
        "ffmpeg",
        "-rtsp_transport", "tcp",
        "-analyzeduration", "10000000",
        "-probesize", "10000000",
        "-i",rtsp_url,
        "-map", "0:v:0",
        "-map", "0:a:0",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-tune", "zerolatency",
        "-c:a", "aac",
        "-f", "hls",
        "-hls_time", "2",
        "-hls_list_size", "5",
        "-hls_flags", "delete_segments",
        os.path.join(Hsl_directory, "stream.m3u8")

    ]

    ffmpeg_process = subprocess.Popen(cmd,preexec_fn=os.setsid)
    # Build full stream URL using request.host_url
    stream_url = request.host_url.rstrip('/') + '/hls/stream.m3u8'
    return jsonify({"message": "Stream started", "stream_url": stream_url})

@app.route("/stream_stop",methods=["POST"])
def stream_stop():
    global ffmpeg_process
    if ffmpeg_process:
        os.killpg(os.getpgid(ffmpeg_process.pid),signal.SIGTERM)
        ffmpeg_process = None
        return jsonify({"message":"Stream Stopped"})
    return jsonify({"error":"no stream running"}),400    


@app.route("/hls/<path:filename>")
def serve_hls(filename):
    return send_from_directory(Hsl_directory, filename)
@app.route("/")
def hello_world():
    return "<p>Hello, World!</p>"