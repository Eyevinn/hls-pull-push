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

/* Generate mapings of URLs to file names, will be used for writing playlist manifests and handling the files */
export const GenerateSegmentNameMap = (segments: ISegments): Map<string, string> => {

  const nameMap = new Map<string, string>();
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
        const fileExtension = ".ts" // assuming input is MPEG TS-file.
        const fileName = `channel_${bw}-${segments["video"][bw].segList[i].index}${fileExtension}`
        nameMap.set(segmentUri, fileName);
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
            const fileExtension = ".aac" // assuming input is AAC.
            const fileName = `channel_a-${group.replaceAll("_", "-")}-${lang}-${segments["audio"][group][lang].segList[i].index}${fileExtension}`;
            nameMap.set(segmentUri, fileName);
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
            const fileExtension = ".vtt" // assuming input is WEBVTT.
            const fileName = `channel_s-${group.replaceAll("_", "-")}-${lang}-${segments["subtitle"][group][lang].segList[i].index}${fileExtension}`;
            nameMap.set(segmentUri, fileName);
          }
        }
      }
    });
  }
  return nameMap;
};

