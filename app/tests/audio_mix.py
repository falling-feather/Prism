"""Decode real FFmpeg output to catch source PTS shifting delayed audio."""
from pathlib import Path
import sys,subprocess,array,math
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from render_svgfilm import audio_filters
tracks=[{'start':2,'offset':.25,'duration':4,'volume':1,'fadeIn':1,'fadeOut':1}]
f=audio_filters(tracks,1,6)
raw=subprocess.check_output(['ffmpeg','-v','error','-f','lavfi','-i','color=s=16x16:d=1','-f','lavfi','-i','sine=frequency=440:duration=6:sample_rate=48000','-filter_complex',f,'-map','[mix]','-ac','1','-ar','48000','-f','f32le','pipe:1'])
a=array.array('f');a.frombytes(raw)
def rms(t):
    samples=a[int(t*48000):int((t+.2)*48000)];return math.sqrt(sum(v*v for v in samples)/len(samples))
assert abs(len(a)/48000-6)<.001
assert rms(.2)<.0001 and rms(5.5)<.0001
assert rms(2.2)>rms(1.2)*2 and rms(2.2)>rms(4.5)
print('Encoded audio offset, duration and fade envelope: passed')
