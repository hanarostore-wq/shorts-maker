#!/usr/bin/env bash
# 테스트용 영상 픽스처 생성 (ffmpeg 필요). 결과물은 git 에 올리지 않는다.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p media && cd media
ff() { ffmpeg -loglevel error -y "$@"; }
ff -f lavfi -i testsrc2=size=1080x1920:rate=30 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 6 -c:v libx264 -preset veryfast -pix_fmt yuv420p -g 30 -c:a aac -b:a 128k -movflags +faststart progressive_1080x1920.mp4
ff -f lavfi -i testsrc2=size=640x360:rate=30 -f lavfi -i sine=frequency=330 -t 6 -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -movflags +faststart progressive_360p.mp4
ff -f lavfi -i testsrc2=size=1920x1080:rate=30 -f lavfi -i sine=frequency=880 -t 6 -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -movflags +faststart progressive_1080p_land.mp4
ff -f lavfi -i testsrc2=size=1920x1080:rate=30 -t 6 -an -c:v libx264 -preset veryfast -pix_fmt yuv420p -g 30 -movflags +frag_keyframe+empty_moov+default_base_moof+global_sidx dash_video_avc.mp4
ff -f lavfi -i testsrc2=size=1080x1920:rate=30 -t 6 -an -c:v libx264 -preset veryfast -pix_fmt yuv420p -g 30 -movflags +frag_keyframe+empty_moov+default_base_moof dash_video_vertical.mp4
ff -f lavfi -i sine=frequency=550:sample_rate=44100 -t 6 -vn -c:a aac -b:a 128k -movflags +frag_keyframe+empty_moov+default_base_moof dash_audio.m4a
ff -f lavfi -i testsrc2=size=1280x720:rate=30 -t 6 -an -c:v libvpx-vp9 -b:v 800k -deadline realtime -cpu-used 8 dash_video_vp9.webm
ff -f lavfi -i sine=frequency=660:sample_rate=48000 -t 6 -vn -c:a libopus -b:a 96k dash_audio_opus.webm
ff -f lavfi -i testsrc2=size=640x360:rate=30 -f lavfi -i sine=frequency=300 -t 6 -c:v libvpx-vp9 -b:v 300k -deadline realtime -cpu-used 8 -c:a libopus preview.webm
ff -f lavfi -i testsrc2=size=1280x720:rate=30 -f lavfi -i sine=frequency=500 -t 6 -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -f mov original_upload.mov
mkdir -p hls_ts hls_fmp4
ff -f lavfi -i testsrc2=size=1280x720:rate=30 -f lavfi -i sine=frequency=500 -t 6 \
  -filter_complex "[0:v]split=2[a][b];[b]scale=640:360[b2]" -map "[a]" -map 1:a -map "[b2]" -map 1:a \
  -c:v libx264 -preset veryfast -g 30 -c:a aac -b:a 128k -f hls -hls_time 2 -hls_playlist_type vod \
  -hls_segment_filename "hls_ts/v%v_seg%d.ts" -master_pl_name master.m3u8 -var_stream_map "v:0,a:0 v:1,a:1" hls_ts/v%v.m3u8
ff -f lavfi -i testsrc2=size=1920x1080:rate=30 -f lavfi -i sine=frequency=700 -t 6 \
  -filter_complex "[0:v]split=2[a][b];[b]scale=960:540[b2]" -map "[a]" -map "[b2]" -map 1:a \
  -c:v libx264 -preset veryfast -g 30 -c:a aac -b:a 128k -f hls -hls_time 2 -hls_playlist_type vod -hls_segment_type fmp4 \
  -hls_segment_filename "hls_fmp4/s%v_%d.m4s" -hls_fmp4_init_filename "init_%v.mp4" -master_pl_name master.m3u8 \
  -var_stream_map "v:0,agroup:aud v:1,agroup:aud a:0,agroup:aud,default:yes" hls_fmp4/p%v.m3u8
ff -f lavfi -i testsrc2=size=320x180:rate=15 -f lavfi -i sine=frequency=400 -t 95 -c:v libvpx-vp9 -b:v 80k -deadline realtime -cpu-used 8 -c:a libopus -b:a 32k long_95s.webm
# 첫 0.6초는 검은 화면, 그 뒤로 위쪽에 사람(피부색)이 있고 아래쪽은 비어 있는 영상 → 요약 글자는 아래로 가야 함
ff -f lavfi -i color=c=black:s=640x360:r=30:d=0.6 -f lavfi -i "color=c=0x2a3040:s=640x360:r=30:d=5.4" -f lavfi -i sine=frequency=500:duration=6 \
  -filter_complex "[1:v]drawbox=x=200:y=8:w=240:h=150:color=0xE0AC90:t=fill,drawbox=x=150:y=60:w=340:h=40:color=0xD49A80:t=fill,noise=alls=12:allf=t[p];[0:v][p]concat=n=2:v=1:a=0[v]" \
  -map "[v]" -map 2:a -c:v libvpx-vp9 -b:v 600k -deadline realtime -cpu-used 8 -c:a libopus -b:a 64k person_top.webm
mkdir -p images
ff -f lavfi -i testsrc2=size=1200x800 -frames:v 1 images/photo.webp
ff -f lavfi -i testsrc2=size=1600x1000 -frames:v 1 images/photo.jpg
ff -f lavfi -i testsrc2=size=2000x1500 -frames:v 1 images/x_orig.jpg
ff -f lavfi -i testsrc2=size=680x510 -frames:v 1 images/x_small.jpg
echo "픽스처 생성 완료: $(pwd)"
