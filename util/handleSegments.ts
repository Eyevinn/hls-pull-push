// ********************/
// Helper Functions
// ********************/
import { ISegments } from "@eyevinn/hls-recorder";
const debug = require("debug")("hls-pull-push");
/**
 * Function extracts new segment items based on the difference in media sequence
 * @param {Object*} Segments
 * @param {number*} prevMediaSeq
 * @returns Only new segment items
 */
export const GetOnlyNewestSegments = (
  Segments: ISegments,
  latestSegmentIndex: number
): ISegments => {
  let newestSegments = {
    video: {},
    audio: {},
    subtitle: {},
  };
  const Bandwidths = Object.keys(Segments["video"]);
  const newSegCount = Segments["video"][Bandwidths[0]].segList.length;

  const position = Segments["video"][Bandwidths[0]].segList.findIndex(
    (seg) => seg.index === latestSegmentIndex
  );
  let sliceOffset: number;
  if (position === -1) {
    sliceOffset = 1; // <--- If we don't want to collect everything, then specify how namy here.
  } else {
    sliceOffset = newSegCount - position - 1;
  }

  // First Get Video Segments...
  Bandwidths.forEach((bw) => {
    newestSegments["video"][bw] = {
      mediaSeq: -1,
      segList: [],
    };
    // Before altering key values - Make deep copy.
    let segmentList = JSON.parse(JSON.stringify(Segments["video"][bw].segList));
    newestSegments["video"][bw].mediaSeq = Segments["video"][bw].mediaSeq;
    newestSegments["video"][bw].segList = segmentList.slice(newSegCount - sliceOffset);
  });
  // Second Get Audio Segments if any exists...
  for (let i = 0; i < Object.keys(Segments["audio"]).length; i++) {
    let group = Object.keys(Segments["audio"])[i];
    newestSegments["audio"][group] = {};
    Object.keys(Segments["audio"][group]).forEach((lang) => {
      newestSegments["audio"][group][lang] = {
        mediaSeq: -1,
        segList: [],
      };
      newestSegments["audio"][group][lang].mediaSeq =
        Segments["audio"][group][lang].mediaSeq;
      let segmentList = JSON.parse(
        JSON.stringify(Segments["audio"][group][lang].segList)
      );
      newestSegments["audio"][group][lang].segList = segmentList.slice(
        newSegCount - sliceOffset
      );
    });
  }
  // Third Get Subtitles Segments if any exists...
  for (let i = 0; i < Object.keys(Segments["subtitle"]).length; i++) {
    let group = Object.keys(Segments["subtitle"])[i];
    newestSegments["subtitle"][group] = {};
    Object.keys(Segments["subtitle"][group]).forEach((lang) => {
      newestSegments["subtitle"][group][lang] = {
        mediaSeq: -1,
        segList: [],
      };
      newestSegments["subtitle"][group][lang].mediaSeq =
        Segments["subtitle"][group][lang].mediaSeq;
      let segmentList = JSON.parse(
        JSON.stringify(Segments["subtitle"][group][lang].segList)
      );
      newestSegments["subtitle"][group][lang].segList = segmentList.slice(
        newSegCount - sliceOffset
      );
    });
  }
  return newestSegments;
};

/* These URLs will be what is written in the playlist manifest we later generate */
export const ReplaceSegmentURLs = (segments: ISegments): ISegments => {
  // Before altering key values - Make deep copy.
  segments = JSON.parse(JSON.stringify(segments));

  const bandwidths = Object.keys(segments["video"]);
  const groups = Object.keys(segments["audio"]);
  const subGroups = Object.keys(segments["subtitle"]);
  // For Video
  bandwidths.forEach((bw) => {
    let segListSize = segments["video"][bw].segList.length;
    for (let i = 0; i < segListSize; i++) {
      const segmentUri: string = segments["video"][bw].segList[i].uri;
      if (segmentUri) {
        const replacementUrl = `channel_${bw}_${segments["video"][bw].segList[i].index}.ts`; // assuming input is MPEG TS-file.
        segments["video"][bw].segList[i].uri = replacementUrl;
      }
    }
  });
  // For Audio, if any exists
  if (groups.length > 0) {
    groups.forEach((group) => {
      const languages = Object.keys(segments["audio"][group]);
      for (let k = 0; k < languages.length; k++) {
        const lang = languages[k];
        let segListSize = segments["audio"][group][lang].segList.length;
        for (let i = 0; i < segListSize; i++) {
          const segmentUri = segments["audio"][group][lang].segList[i].uri;
          if (segmentUri) {
            const replacementUrl = `channel_a-${group}-${lang}_${segments["audio"][group][lang].segList[i].index}.aac`; // assuming input is AAC.
            //const replacementUrl = `audio/${group}/${lang}/channel_${group}-${lang}_${segments["audio"][group][lang].segList[i].index}.aac`; // assuming input is AAC.
            segments["audio"][group][lang].segList[i].uri = replacementUrl;
          }
        }
      }
    });
  }
  // For Subs, if any exists
  if (subGroups.length > 0) {
    subGroups.forEach((group) => {
      const languages = Object.keys(segments["subtitle"][group]);
      for (let k = 0; k < languages.length; k++) {
        const lang = languages[k];
        let segListSize = segments["subtitle"][group][lang].segList.length;
        for (let i = 0; i < segListSize; i++) {
          const segmentUri = segments["subtitle"][group][lang].segList[i].uri;
          if (segmentUri) {
            const replacementUrl = `channel_s-${group}-${lang}_${segments["subtitle"][group][lang].segList[i].index}.vtt`; // assuming input is WEBVTT.
            //const replacementUrl = `subtitle/${group}/${lang}/channel_${group}-${lang}_${segments["subtitle"][group][lang].segList[i].index}.vtt`; // assuming input is WEBVTT.
            segments["subtitle"][group][lang].segList[i].uri = replacementUrl;
          }
        }
      }
    });
  }
  return segments;
};

