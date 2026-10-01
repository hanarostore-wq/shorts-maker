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
echo "픽스처 생성 완료: $(pwd)"
