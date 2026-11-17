"""Shot changes in a video with PySceneDetect (BSD 3-Clause), for cuts that land exactly between shots.

Usage: python scenes.py <video> -> prints {"cuts": [seconds, ...], "fps": n} as JSON.
"""
import json
import sys

try:
    from scenedetect import open_video, SceneManager
    from scenedetect.detectors import AdaptiveDetector, ContentDetector
except ImportError as e:
    print(json.dumps({'error': 'missing: ' + str(e)}))
    sys.exit(3)

video = open_video(sys.argv[1])
sm = SceneManager()
# adaptive: copes with camera moves and flashes; content: catches the plain hard cuts it might skip
sm.add_detector(AdaptiveDetector(min_scene_len=8))
sm.add_detector(ContentDetector(threshold=30, min_scene_len=8))
sm.auto_downscale = True
sm.detect_scenes(video, show_progress=False)
cuts = sorted({round(s[0].get_seconds(), 3) for s in sm.get_scene_list() if s[0].get_seconds() > 0.05})
print(json.dumps({'cuts': cuts, 'fps': float(video.frame_rate)}))
