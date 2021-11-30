import uuid from "uuid/v4";
import * as path from "path";
// import { promise as fastq } from "fastq";
import { HLSRecorder, ISegments, PlaylistType, Segment } from "@eyevinn/hls-recorder";
import { promise as fastq } from "fastq";
import * as fs from "fs";
import {
  GetOnlyNewestSegments,
  ReplaceSegmentURLs,
  UploadAllSegments,
  PushSegments,
} from "../util/handleSegments";
import { AuthType, createClient, WebDAVClient } from "webdav";
//const createClient = require("webdav-tulip");
import { ListOriginEndpointsCommand } from "@aws-sdk/client-mediapackage";
import {
  GenerateAudioM3U8,
  GenerateMediaM3U8,
  GenerateSubtitleM3U8,
} from "@eyevinn/hls-recorder/dist/util/manifest_generator";
import { Stream } from "stream";
const debug = require("debug")("hls-pull-push");
const request = require("request");
const stream = require("stream");
const fetch = require("node-fetch");
//require("dotenv").config();
//const { AwsUploadModule } = require("@eyevinn/iaf-plugin-aws-s3");
export class Session {
  sessionId: string;
  created: string;
  hlsrecorder: HLSRecorder;
  active: boolean;
  collectedSegments: ISegments;
  concurrentWorkers: number | null;
  sourceTargetDuration: number | null;
  sourcePrevMseq: number | null;
  previousMseq: number;
  previousSegCount: number;
  atFirstIncrement: boolean;
  cookieJar: any;
  segmentTargetDuration: any;
  sourceIsEvent: boolean;
  sourceURL: string;
  name: string;
  destination: string;
  client: any; //WebDAVClient;
  masterM3U8: any;
  m3u8Queue: any;
  segQueue: any;
  outputDestination: any;

  constructor(params) {
    this.sessionId = uuid();
    this.client = null;
    this.created = new Date().toISOString();
    this.atFirstIncrement = true;
    this.sourceIsEvent = false;
    this.previousMseq = 0;
    this.previousSegCount = 0;
    this.cookieJar = null;
    this.sourceURL = params.url;
    this.name = params.name;
    this.hlsrecorder = new HLSRecorder(this.sourceURL, {
      recordDuration: -1,
      windowSize: -1,
      vod: true,
    });
    if (params.concurrency) {
      this.concurrentWorkers = params.concurrency;
    } else {
      this.concurrentWorkers = parseInt(process.env.DEFAULT_UPLOAD_CONCURRENCY) || 16;
    }
    this.outputDestination = params.dest;
    this.active = true;
    this.sourcePrevMseq = 0;
    this.collectedSegments = {
      video: {},
      audio: {},
      subtitle: {},
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
      if (data.type === PlaylistType.EVENT) {
        this.sourceIsEvent = true;
      }
      // When stopped, either by DELETE endpoint or by Event content...
      // Session becomes inactive
      if (this.active) {
        this.segmentTargetDuration = this.hlsrecorder.recorderM3U8TargetDuration;
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
          let latestSegmentIndex = this._getLatestSegmentIndex();
          BottomSegs = GetOnlyNewestSegments(
            data.allPlaylistSegments,
            latestSegmentIndex
          );
        }
        let bw = Object.keys(BottomSegs["video"])[0];

        // TODO: What should hls-pull-push do if livestream is event and goes vod.
        //
        // Stop recorder if source became a VOD
        if (data.type === PlaylistType.VOD) {
          debug(
            `[${this.sessionId}]: Stopping HLSRecorder due to recording becoming a VOD`
          );
          // this.recorder.PlaylistType = PlaylistType.VOD
          await this.StopHLSRecorder();
        }

        // Add new editions to internal collection
        PushSegments(this.sessionId, this.collectedSegments, BottomSegs);

        // Update Previous Source Mseq and SegCount *check*
        this.previousMseq = BottomSegs["video"][bw].mediaSeq;
        this.previousSegCount = data.allPlaylistSegments["video"][bw].segList.length;

        debug(
          `[${this.sessionId}]: Trying to Push all new hlsrecorder segments to Output: ${this.created}`
        );
        // Upload Master If not already done...
        if (!this.masterM3U8) {
          try {
            console.log("TRY upload multivariant manifest...");
            this.masterM3U8 = this.hlsrecorder.masterManifest.replace(/master/g, "channel_");
            await this.outputDestination.uploadMediaPlaylist({
              fileName: "channel.m3u8",
              fileData: this.masterM3U8,
            });
            debug(`[${this.sessionId}]: MultiVariant Manifest sent to Output`);
          } catch (error) {
            console.error("(!) Issue with webDAV");
            throw new Error(error);
          }
        }
        let SegmentsWithNewURL;
        let tasksSegments;
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
              this.segmentTargetDuration
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

  _getLatestSegmentIndex(): number {
    if (Object.keys(this.collectedSegments["video"]).length > 0) {
      const bandwidths: string[] = Object.keys(this.collectedSegments["video"]);
      const segList: Segment[] = this.collectedSegments["video"][bandwidths[0]].segList;
      const endIndex: number = segList[segList.length - 1].index;
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
    targetDuration: number
  ): Promise<any[]> {
    const tasks = [];
    const bandwidths = Object.keys(segments["video"]);
    const groupsAudio = Object.keys(segments["audio"]);
    const groupsSubs = Object.keys(segments["subtitle"]);
    // Upload all Playlist Manifest, Start with Video, then do Audio if exists
    bandwidths.forEach(async (bw) => {
      let generatorOptions = {
        mseq: 0,
        targetDuration: targetDuration,
        allSegments: segments,
      };
      GenerateMediaM3U8(parseInt(bw), generatorOptions).then((playlistM3u8) => {
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
            mseq: 0,
            targetDuration: targetDuration,
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
            mseq: 0,
            targetDuration: targetDuration,
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
}
