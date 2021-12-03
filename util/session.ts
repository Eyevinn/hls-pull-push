import uuid from "uuid/v4";
// import { promise as fastq } from "fastq";
import { HLSRecorder, ISegments, PlaylistType, Segment } from "@eyevinn/hls-recorder";
import { promise as fastq } from "fastq";
import { GetOnlyNewestSegments, ReplaceSegmentURLs } from "../util/handleSegments";
import {
  GenerateAudioM3U8,
  GenerateMediaM3U8,
  GenerateSubtitleM3U8,
} from "@eyevinn/hls-recorder/dist/util/manifest_generator";
import { IOutputPluginDest } from "../types/output_plugin";
const debug = require("debug")("hls-pull-push");

//require("dotenv").config();
//const { AwsUploadModule } = require("@eyevinn/iaf-plugin-aws-s3");
//import { ListOriginEndpointsCommand } from "@aws-sdk/client-mediapackage";

export class Session {
  sessionId: string;
  created: string;
  hlsrecorder: HLSRecorder;
  active: boolean;
  collectedSegments: ISegments;
  targetWindowSize: number;
  currentWindowSize: number;
  concurrentWorkers: number | null;
  sourceTargetDuration: number | null;
  sourcePrevMseq: number | null;
  atFirstIncrement: boolean;
  cookieJar: any;
  sourceIsEvent: boolean;
  sourceURL: string;
  name: string;
  destination: string;
  client: any; //WebDAVClient;
  masterM3U8: any;
  m3u8Queue: any;
  segQueue: any;
  outputDestination: any;
  m3uPlaylistData: { mseq: number; dseq: number; targetDur: number };

  constructor(params: {
    name: any;
    url: any;
    plugin: IOutputPluginDest;
    dest: any;
    concurrency: any;
    windowSize: any;
  }) {
    this.sessionId = uuid();
    this.client = null;
    this.created = new Date().toISOString();
    this.atFirstIncrement = true;
    this.sourceIsEvent = false;
    this.cookieJar = null;
    this.destination = params.dest;
    this.sourceURL = params.url;
    this.name = params.name;
    this.targetWindowSize = params.windowSize ? params.windowSize : -1;
    this.currentWindowSize = 0;
    this.hlsrecorder = new HLSRecorder(this.sourceURL, {
      recordDuration: -1,
      windowSize: this.targetWindowSize || -1,
      vod: true,
    });
    if (params.concurrency) {
      this.concurrentWorkers = params.concurrency;
    } else {
      this.concurrentWorkers = parseInt(process.env.DEFAULT_UPLOAD_CONCURRENCY) || 16;
    }
    this.outputDestination = params.plugin;
    this.active = true;
    this.sourcePrevMseq = 0;
    this.collectedSegments = {
      video: {},
      audio: {},
      subtitle: {},
    };
    this.m3uPlaylistData = {
      mseq: 0,
      dseq: 0,
      targetDur: 0,
    };
    // Init queue workers, one for segments, one for manifests
    this.m3u8Queue = fastq(
      this.outputDestination.uploadMediaPlaylist.bind(this.outputDestination),
      this.concurrentWorkers
    );
    this.segQueue = fastq(
      this.outputDestination.uploadMediaSegment.bind(this.outputDestination),
      this.concurrentWorkers
    );

    // .-------------------------------------------.
    // |   Processing new recorder segment items   |
    // '-------------------------------------------'
    this.hlsrecorder.on("mseq-increment", async (data) => {
      if (data.type === PlaylistType.EVENT && !this.sourceIsEvent) {
        this.sourceIsEvent = true;
      } else if (data.type === PlaylistType.LIVE && this.targetWindowSize === -1) {
        this.targetWindowSize = 2 * 60; // Default to 2 minutes if source HLS steam is type LIVE.
      }
      // When stopped, either by 'StopHLSRecorder' or by Event content...
      // ...Session becomes inactive
      if (this.active) {
        if (data.cookieJar) {
          this.cookieJar = data.cookieJar;
        }
        const segsVideo = data.allPlaylistSegments["video"];
        debug(
          `[${
            this.sessionId
          }]: HLSRecorder event triggered. Recieved new segments. Totals amount per variant=${
            segsVideo[Object.keys(segsVideo)[0]].segList.length
          }`
        );

        let BottomSegs: ISegments = {
          video: {},
          audio: {},
          subtitle: {},
        };
        if (this.atFirstIncrement && data.type === PlaylistType.VOD) {
          BottomSegs = Object.assign({}, data.allPlaylistSegments);
        } else {
          let latestSegmentIndex = this._getLatestSegmentIndex(this.collectedSegments);
          BottomSegs = GetOnlyNewestSegments(data.allPlaylistSegments, latestSegmentIndex);
        }
        // TODO: What should hls-pull-push do if livestream is event and goes vod.
        //
        // Stop recorder if source became a VOD
        if (data.type === PlaylistType.VOD) {
          debug(`[${this.sessionId}]: Stopping HLSRecorder due to recording becoming a VOD`);
          // this.recorder.PlaylistType = PlaylistType.VOD
          await this.StopHLSRecorder();
        }

        // Add new editions to internal collection
        this._PushSegments(this.collectedSegments, BottomSegs);

        // Window Size & playlistData update
        if (this.targetWindowSize !== -1) {
          const segRemovalData = this._AdjustForWindowSize(this.collectedSegments);
          debug(
            `Current Window Size [ ${this.currentWindowSize} ]. Target Window Size [ ${this.targetWindowSize} ]`
          );
          this.m3uPlaylistData.mseq += segRemovalData.segmentsReleased;
          debug(
            `[${this.sessionId}]: Sessions internal m3u8 media-sequence count ${
              segRemovalData.segmentsReleased === 0
                ? "is unchanged"
                : `now at: [ ${this.m3uPlaylistData.mseq} ]`
            }`
          );
          if (segRemovalData.discontinuityTagsReleased !== 0) {
            this.m3uPlaylistData.dseq += segRemovalData.discontinuityTagsReleased;
            debug(
              `[${this.sessionId}]: Recorders internal discontinuity-sequence count now at: [ ${this.m3uPlaylistData.dseq} ]`
            );
          }
        }
        this.m3uPlaylistData.targetDur = this._getTargetDuration(this.collectedSegments);

        debug(`[${this.sessionId}]: Trying to Push all new hlsrecorder segments to Output`);

        // Upload Master If not already done...
        if (!this.masterM3U8) {
          try {
            console.log("Try upload multivariant manifest...");
            this.masterM3U8 = this.hlsrecorder.masterManifest.replace(/master/g, "channel_");
            let result = await this.outputDestination.uploadMediaPlaylist({
              fileName: "channel.m3u8",
              fileData: this.masterM3U8,
            });
            if (result) {
              debug(`[${this.sessionId}]: MultiVariant Manifest sent to Output`);
            } else {
              debug(`[${this.sessionId}]: (!) Sending MultiVariant Manifest to Output Failed`);
              this.masterM3U8 = null;
            }
          } catch (error) {
            console.error("Issue with webDAV", error);
            throw new Error(error);
          }
        }
        let SegmentsWithNewURL: ISegments;
        let tasksSegments: any[];
        try {
          // Upload all newest segments to S3 Bucket
          tasksSegments = await this._UploadAllSegments(this.segQueue, BottomSegs);
          // Make Segment Urls formatted and ready for Manifest Generation
          SegmentsWithNewURL = ReplaceSegmentURLs(this.collectedSegments);
          // Let the Workers Work!
          const resultsSegments = [];
          for (let result of tasksSegments) {
            resultsSegments.push(await result);
          }
          debug(`[${this.sessionId}]: Finished uploading all segments!`);

          if (this.atFirstIncrement || this.sourceIsEvent || this.active) {
            // Upload Recording Playlist Manifest to S3 Bucket
            let tasksManifest = await this._UploadAllManifest(
              this.m3u8Queue,
              SegmentsWithNewURL,
              this.m3uPlaylistData
            );
            // Let the Workers Work!
            const resultsManifest = [];
            for (let result of tasksManifest) {
              resultsManifest.push(await result);
            }
            debug(`[${this.sessionId}]: Finished uploading all m3u8 manifests!`);
          }
        } catch (err) {
          console.error(err);
        }
        // Set to False, no longer first increment
        this.atFirstIncrement = false;
      }
    });

    this.hlsrecorder.on("error", (err) => {
      debug(`[${this.sessionId}]: Error from HLS Recorder! ${err}`);
      this.StopHLSRecorder();
    });
    // Start Recording the HLS stream
    this.hlsrecorder.start();
  }

  isActive(): boolean {
    return this.active;
  }

  async StopHLSRecorder(): Promise<void> {
    if (this.hlsrecorder) {
      await this.hlsrecorder.stop();
      this.active = false;
      debug(`[${this.sessionId}]: Recorder session set to inactive`);
    }
  }

  toJSON() {
    return {
      fetcherId: this.sessionId,
      created: this.created,
      name: this.name,
      url: this.sourceURL,
      dest: this.destination,
      concurrency: this.concurrentWorkers,
    };
  }

  /** PRIVATE FUNCTUIONS */

  _getLatestSegmentIndex(segments: ISegments): number {
    let endIndex: number;
    if (Object.keys(segments["video"]).length > 0) {
      const bandwidths: string[] = Object.keys(segments["video"]);
      const segList: Segment[] = segments["video"][bandwidths[0]].segList;
      if (segList.length > 0) {
        endIndex = segList[segList.length - 1].index;
      }
      return endIndex;
    }
    return -1;
  }

  async _UploadAllSegments(taskQueue: any, segments: ISegments): Promise<any[]> {
    const tasks = [];
    const bandwidths = Object.keys(segments["video"]);
    const groupsAudio = Object.keys(segments["audio"]);
    const groupsSubs = Object.keys(segments["subtitle"]);
    // Start pushing segments for all variants before moving on the next
    let segListSize = segments["video"][bandwidths[0]].segList.length;
    for (let i = 0; i < segListSize; i++) {
      bandwidths.forEach((bw) => {
        const segmentUri = segments["video"][bw].segList[i].uri;
        if (segmentUri) {
          // Design of the File Name here:
          const segmentFileName = `channel_${bw}_${segments["video"][bw].segList[i].index}.ts`;
          let item = {
            segment_uri: segmentUri,
            file_name: segmentFileName,
          };
          console.log("pushed a Segment Upload Task");
          tasks.push(taskQueue.push(item));
        }
      });
    }
    /* 
    
    TODO: Support Multi-tracks
    
    // For Demux Audio
    if (groupsAudio.length > 0) {
      // Start pushing segments for all variants before moving on the next
      let _lang = Object.keys(segments["audio"][groupsAudio[0]])[0];
      let segListSize = segments["audio"][groupsAudio[0]][_lang].segList.length;
      for (let i = 0; i < segListSize; i++) {
        groupsAudio.forEach((group) => {
          const languages = Object.keys(segments["audio"][group]);
          for (let k = 0; k < languages.length; k++) {
            const lang = languages[k];
            const segmentUri = segments["audio"][group][lang].segList[i].uri;
            if (segmentUri) {
              let item = {
                mp_endpoints: endpoints,
                segment_uri: segmentUri,
              };
              tasks.push(taskQueue.push(item));
            }
          }
        });
      }
    }
    // For Subtitles
    if (groupsSubs.length > 0) {
      // Start pushing segments for all variants before moving on the next
      let _lang = Object.keys(segments["subtitle"][groupsSubs[0]])[0];
      let segListSize = segments["subtitle"][groupsSubs[0]][_lang].segList.length;
      for (let i = 0; i < segListSize; i++) {
        groupsSubs.forEach((group) => {
          const languages = Object.keys(segments["subtitle"][group]);
          for (let k = 0; k < languages.length; k++) {
            const lang = languages[k];
            const segmentUri = segments["subtitle"][group][lang].segList[i].uri;
            if (segmentUri) {
              let item = {
                mp_endpoints: endpoints,
                segment_uri: segmentUri,
              };
              tasks.push(taskQueue.push(item));
            }
          }
        });
      }
    }
    */

    return tasks;
  }

  async _UploadAllManifest(
    taskQueue: any,
    segments: ISegments,
    m3uPlaylistData: { mseq: number; dseq: number; targetDur: number }
  ): Promise<any[]> {
    const tasks = [];
    const bandwidths = Object.keys(segments["video"]);
    const groupsAudio = Object.keys(segments["audio"]);
    const groupsSubs = Object.keys(segments["subtitle"]);
    // Upload all Playlist Manifest, Start with Video, then do Audio if exists
    bandwidths.forEach(async (bw) => {
      let generatorOptions = {
        mseq: m3uPlaylistData.mseq,
        dseq: m3uPlaylistData.dseq,
        targetDuration: m3uPlaylistData.targetDur,
        allSegments: segments,
      };
      GenerateMediaM3U8(parseInt(bw), generatorOptions).then((playlistM3u8: string) => {
        const playlistToBeUploaded: string = playlistM3u8.replace(/master/g, "channel");
        const name = `channel_${bw}.m3u8`;
        let item = {
          fileName: name,
          fileData: playlistToBeUploaded,
        };
        tasks.push(taskQueue.push(item));
      });
    });
    /*

    TODO: Support Multi-tracks

    // For Demux Audio
    if (groupsAudio.length > 0) {
      groupsAudio.forEach(async (group) => {
        const languages = Object.keys(segments["audio"][group]);
        for (let k = 0; k < languages.length; k++) {
          const lang = languages[k];
      let generatorOptions = {
        mseq: m3uPlaylistData.mseq,
        dseq: m3uPlaylistData.dseq,
        targetDuration: m3uPlaylistData.targetDur,
        allSegments: segments,
      };
          GenerateAudioM3U8(group, lang, generatorOptions).then((playlistM3u8) => {
            const name = `master-audio_${group}_${lang}`;
            let item = {
              mp_endpoints: endpoints,
              file_name: name,
              data: playlistM3u8,
            };
            tasks.push(taskQueue.push(item));
          });
        }
      });
    }
    // For Subtitles
    if (groupsSubs.length > 0) {
      groupsSubs.forEach(async (group) => {
        const languages = Object.keys(segments["subtitle"][group]);
        for (let k = 0; k < languages.length; k++) {
          const lang = languages[k];
      let generatorOptions = {
        mseq: m3uPlaylistData.mseq,
        dseq: m3uPlaylistData.dseq,
        targetDuration: m3uPlaylistData.targetDur,
        allSegments: segments,
      };
          GenerateSubtitleM3U8(group, lang, generatorOptions).then((playlistM3u8) => {
            const name = `master-sub_${group}_${lang}`;
            let item = {
              mp_endpoints: endpoints,
              file_name: name,
              data: playlistM3u8,
            };
            tasks.push(taskQueue.push(item));
          });
        }
      });
    }
    */
    return tasks;
  }

  _PushSegments = (Segments: ISegments, newSegments: ISegments): void => {
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
            let segInfo: string;
            if (newVideoSegment.index) {
              segInfo = `index=${newVideoSegment.index}`;
            } else if (newVideoSegment.endlist) {
              segInfo = `endlist-tag`;
            } else {
              segInfo = `other hls tag`;
            }
            debug(
              `[${this.sessionId}]: Added Segments(${segInfo}) to Cache-HLS Playlist_${bw}\n${newVideoSegment.uri}`
            );

            // Update Session's current window size based on segment duration.
            if (bw === Object.keys(Segments["video"])[0]) {
              if (this.targetWindowSize !== -1) {
                this.currentWindowSize += newVideoSegment?.duration ? newVideoSegment.duration : 0;
              }
            }
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
          Segments["audio"][group][lang].mediaSeq = newSegments["audio"][group][lang].mediaSeq;

          for (let idx = 0; idx < newSegments["audio"][group][lang].segList.length; idx++) {
            // update seglist
            let newAudioSegment = newSegments["audio"][group][lang].segList[idx];
            if (!Segments["audio"][group][lang].segList.some((seg) => seg.index === newAudioSegment.index)) {
              Segments["audio"][group][lang].segList.push(newAudioSegment);

              // Log what has been pushed - REMOVE LATER
              let segInfo: string;
              if (newAudioSegment.index) {
                segInfo = `index=${newAudioSegment.index}`;
              } else if (newAudioSegment.endlist) {
                segInfo = `endlist-tag`;
              } else {
                segInfo = `other hls tag`;
              }
              debug(`[${this.sessionId}]: Added Segments(${segInfo}) to Cache-HLS Playlist_${group}-${lang}`);
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
          Segments["subtitle"][group][lang].mediaSeq = newSegments["subtitle"][group][lang].mediaSeq;

          for (let idx = 0; idx < newSegments["subtitle"][group][lang].segList.length; idx++) {
            // update seglist
            let newsubtitleSegment = newSegments["subtitle"][group][lang].segList[idx];
            if (
              !Segments["subtitle"][group][lang].segList.some((seg) => seg.index === newsubtitleSegment.index)
            ) {
              Segments["subtitle"][group][lang].segList.push(newsubtitleSegment);

              // Log what has been pushed - REMOVE LATER
              let segInfo: string;
              if (newsubtitleSegment.index) {
                segInfo = `index=${newsubtitleSegment.index}`;
              } else if (newsubtitleSegment.endlist) {
                segInfo = `endlist-tag`;
              } else {
                segInfo = `other hls tag`;
              }
              debug(`[${this.sessionId}]: Added Segments(${segInfo}) to Cache-HLS Playlist_${group}-${lang}`);
            }
          }
        });
      }
    }
  };

  _AdjustForWindowSize(Segments: ISegments): {
    segmentsReleased: number;
    discontinuityTagsReleased: number;
  } {
    let output = {
      segmentsReleased: 0,
      discontinuityTagsReleased: 0,
    };
    while (this.currentWindowSize > this.targetWindowSize) {
      // Add tag to for all media
      const bandwidths = Object.keys(Segments["video"]);
      const groups = Object.keys(Segments["audio"]);
      const groupsSubs = Object.keys(Segments["subtitle"]);
      // Abort if there is nothing to shift!
      if (bandwidths.length === 0 || Segments["video"][bandwidths[0]].segList.length === 0) {
        break;
      }
      // Start Shifting on all video lists
      bandwidths.forEach((bw, index) => {
        const releasedSegmentItem = Segments["video"][bw].segList.shift();
        if (index === 0) {
          if (releasedSegmentItem?.duration) {
            // Reduce current window size...
            this.currentWindowSize -= releasedSegmentItem?.duration ? releasedSegmentItem.duration : 0;
            output.segmentsReleased++;
          }
          if (releasedSegmentItem?.discontinuity) {
            output.discontinuityTagsReleased++;
          }
        }
      });
      // Shifting on all audio lists
      groups.forEach((group) => {
        const langs = Object.keys(Segments["audio"][group]);
        for (let i = 0; i < langs.length; i++) {
          let lang = langs[i];
          Segments["audio"][group][lang].segList.shift();
        }
      });

      // Shifting on all subtitle lists
      groupsSubs.forEach((group) => {
        const langs = Object.keys(Segments["subtitle"][group]);
        for (let i = 0; i < langs.length; i++) {
          let lang = langs[i];
          Segments["subtitle"][group][lang].segList.shift();
        }
      });
    }

    return output;
  }

  _getTargetDuration(Segments: ISegments): number {
    let maxDuration = 0;
    const bandwidths = Object.keys(Segments["video"]);
    if (bandwidths.length > 0) {
      let segList = Segments["video"][bandwidths[0]].segList;
      segList.forEach((seg) => {
        if (seg.duration !== null && seg.duration > maxDuration) {
          maxDuration = seg.duration;
        }
      });
    }
    return Math.ceil(maxDuration);
  }
}
