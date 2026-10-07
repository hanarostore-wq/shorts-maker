const assert = require("node:assert/strict");
const test = require("node:test");
const { sameSignature, streamSignature } = require("./videoConcat");

test("stream signatures require identical video and audio specifications", () => {
  const base = streamSignature({ filePath: "a.mp4", streams: [
    { codec_type: "video", codec_name: "h264", profile: "High", width: 1080, height: 1920, pix_fmt: "yuv420p", r_frame_rate: "30/1" },
    { codec_type: "audio", codec_name: "aac", sample_rate: "48000", channels: 2, channel_layout: "stereo" },
  ] });
  const same = streamSignature({ filePath: "b.mp4", streams: [
    { codec_type: "video", codec_name: "h264", profile: "High", width: 1080, height: 1920, pix_fmt: "yuv420p", r_frame_rate: "30/1" },
    { codec_type: "audio", codec_name: "aac", sample_rate: "48000", channels: 2, channel_layout: "stereo" },
  ] });
  const resized = streamSignature({ filePath: "c.mp4", streams: [
    { codec_type: "video", codec_name: "h264", profile: "High", width: 720, height: 1280, pix_fmt: "yuv420p", r_frame_rate: "30/1" },
    { codec_type: "audio", codec_name: "aac", sample_rate: "48000", channels: 2, channel_layout: "stereo" },
  ] });
  assert.equal(sameSignature(base, same), true);
  assert.equal(sameSignature(base, resized), false);
});
