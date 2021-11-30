/* eslint-disable no-unused-vars */
// ********************/
// Helper Functions
// ********************/
import * as path from "path";
import { ISegments, PlaylistType, Segment } from "@eyevinn/hls-recorder";
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

// DELETE??
export const UploadAllSegments = async (
  uploader: any,
  taskQueue: any,
  segments: ISegments,
  folder: string
) => {
  const tasks = [];
  const bandwidths = Object.keys(segments["video"]);
  const groups = Object.keys(segments["audio"]);
  // Start pushing segments for all variants before moving on the next
  let segListSize = segments["video"][bandwidths[0]].segList.length;
  for (let i = 0; i < segListSize; i++) {
    bandwidths.forEach((bw) => {
      const segmentUri = segments["video"][bw].segList[i].uri;
      if (segmentUri) {
        const awsFolder = folder;
        let item = {
          uploader: uploader,
          uri: segmentUri,
          folder: awsFolder,
        };
        tasks.push(taskQueue.push(item));
      }
    });
  }

  // For Demux Audio
  if (groups.length > 0) {
    // Start pushing segments for all variants before moving on the next
    let _lang = Object.keys(segments["audio"][groups[0]])[0];
    let segListSize = segments["audio"][groups[0]][_lang].segList.length;
    for (let i = 0; i < segListSize; i++) {
      groups.forEach((group) => {
        const languages = Object.keys(segments["audio"][group]);
        for (let k = 0; k < languages.length; k++) {
          const lang = languages[k];
          const segmentUri = segments["audio"][group][lang].segList[i].uri;
          if (segmentUri) {
            const awsFolder = folder;
            let item = {
              uploader: uploader,
              uri: segmentUri,
              folder: awsFolder,
            };
            tasks.push(taskQueue.push(item));
          }
        }
      });
    }
  }

  return tasks;
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
            const replacementUrl = `channel_a-${group}-${lang}_${segments["audio"][group][lang].segList[i].index}.ts`; // assuming input is MPEG TS-file.
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
            const replacementUrl = `channel_s-${group}-${lang}_${segments["subtitle"][group][lang].segList[i].index}.ts`; // assuming input is MPEG TS-file.
            segments["subtitle"][group][lang].segList[i].uri = replacementUrl;
          }
        }
      }
    });
  }
  return segments;
};

export const PushSegments = (
  sessionId: string,
  Segments: ISegments,
  newSegments: ISegments
): void => {
  const bandwidths = Object.keys(newSegments["video"]);
  const groupsAudio = Object.keys(newSegments["audio"]);
  const groupsSubs = Object.keys(newSegments["subtitle"]);

  // Start with pushing video segments
  bandwidths.forEach((bw) => {
    if (newSegments["video"][bw].segList.length > 0) {
      if (!Segments["video"][bw]) {
        Segments["video"][bw] = {
          mediaSeq: -1,
          segList: [],
        };
      }
      // update mseq
      Segments["video"][bw].mediaSeq = newSegments["video"][bw].mediaSeq;
      // update seglist
      for (let idx = 0; idx < newSegments["video"][bw].segList.length; idx++) {
        let newVideoSegment = newSegments["video"][bw].segList[idx];
        // Do not add duplicate seg items. Discontinuity tags and others are allowed.
        if (
          !Segments["video"][bw].segList.some(
            (seg) => seg.index === newVideoSegment.index && seg.index !== null
          )
        ) {
          Segments["video"][bw].segList.push(newVideoSegment);

          // Log what has been pushed - REMOVE LATER
          let segInfo;
          if (newVideoSegment.index) {
            segInfo = `index=${newVideoSegment.index}`;
          } else if (newVideoSegment.endlist) {
            segInfo = `endlist-tag`;
          } else {
            segInfo = `other hls tag`;
          }
          debug(
            `[${sessionId}]: Added Segments(${segInfo}) to Cache-HLS Playlist_${bw}\n${newVideoSegment.uri}`
          );
        }
      }
    }
  });
  // Same for Audio if exists any
  if (groupsAudio.length > 0) {
    for (let i = 0; i < groupsAudio.length; i++) {
      let group = groupsAudio[i];
      if (!Segments["audio"][group]) {
        Segments["audio"][group] = {};
      }
      Object.keys(newSegments["audio"][group]).forEach((lang) => {
        // update mseq
        if (!Segments["audio"][group][lang]) {
          Segments["audio"][group][lang] = {
            mediaSeq: -1,
            segList: [],
          };
        }
        Segments["audio"][group][lang].mediaSeq =
          newSegments["audio"][group][lang].mediaSeq;

        for (let idx = 0; idx < newSegments["audio"][group][lang].segList.length; idx++) {
          // update seglist
          let newAudioSegment = newSegments["audio"][group][lang].segList[idx];
          if (
            !Segments["audio"][group][lang].segList.some(
              (seg) => seg.index === newAudioSegment.index
            )
          ) {
            Segments["audio"][group][lang].segList.push(newAudioSegment);

            // Log what has been pushed - REMOVE LATER
            let segInfo;
            if (newAudioSegment.index) {
              segInfo = `index=${newAudioSegment.index}`;
            } else if (newAudioSegment.endlist) {
              segInfo = `endlist-tag`;
            } else {
              segInfo = `other hls tag`;
            }
            debug(
              `[${sessionId}]: Added Segments(${segInfo}) to Cache-HLS Playlist_${group}-${lang}`
            );
          }
        }
      });
    }
  }
  // And same for Subtitles if any exists
  if (groupsSubs.length > 0) {
    for (let i = 0; i < groupsSubs.length; i++) {
      let group = groupsSubs[i];
      if (!Segments["subtitle"][group]) {
        Segments["subtitle"][group] = {};
      }
      Object.keys(newSegments["subtitle"][group]).forEach((lang) => {
        // update mseq
        if (!Segments["subtitle"][group][lang]) {
          Segments["subtitle"][group][lang] = {
            mediaSeq: -1,
            segList: [],
          };
        }
        Segments["subtitle"][group][lang].mediaSeq =
          newSegments["subtitle"][group][lang].mediaSeq;

        for (
          let idx = 0;
          idx < newSegments["subtitle"][group][lang].segList.length;
          idx++
        ) {
          // update seglist
          let newsubtitleSegment = newSegments["subtitle"][group][lang].segList[idx];
          if (
            !Segments["subtitle"][group][lang].segList.some(
              (seg) => seg.index === newsubtitleSegment.index
            )
          ) {
            Segments["subtitle"][group][lang].segList.push(newsubtitleSegment);

            // Log what has been pushed - REMOVE LATER
            let segInfo;
            if (newsubtitleSegment.index) {
              segInfo = `index=${newsubtitleSegment.index}`;
            } else if (newsubtitleSegment.endlist) {
              segInfo = `endlist-tag`;
            } else {
              segInfo = `other hls tag`;
            }
            debug(
              `[${sessionId}]: Added Segments(${segInfo}) to Cache-HLS Playlist_${group}-${lang}`
            );
          }
        }
      });
    }
  }
};
