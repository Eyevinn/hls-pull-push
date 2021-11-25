import uuid from "uuid/v4";
import * as path from "path";
// import { promise as fastq } from "fastq";
import { HLSRecorder, ISegments, PlaylistType } from "@eyevinn/hls-recorder";
import { promise as fastq } from "fastq";
import * as fs from "fs";
import { GetOnlyNewestSegments, ReplaceSegmentURLs, UploadAllSegments, PushSegments } from "../util/handleSegments";
import { AuthType, createClient, WebDAVClient } from "webdav";
//const createClient = require("webdav-tulip");
import { ListOriginEndpointsCommand } from "@aws-sdk/client-mediapackage";
import { GenerateAudioM3U8, GenerateMediaM3U8, GenerateSubtitleM3U8 } from "@eyevinn/hls-recorder/dist/util/manifest_generator";
import { Stream } from "stream";
const debug = require("debug")("hls-pull-push");
const request = require("request");
const stream = require("stream");
const fetch = require("node-fetch");
//require("dotenv").config();
//const { AwsUploadModule } = require("@eyevinn/iaf-plugin-aws-s3");

const master_channel = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-STREAM-INF:BANDWIDTH=2962000,AVERAGE-BANDWIDTH=3031000,RESOLUTION=1280x720,CODECS="avc1.66.30",FRAME-RATE=24.000
channel_10.m3u8`;

const better_master = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-STREAM-INF:BANDWIDTH=550172,AVERAGE-BANDWIDTH=3031000,RESOLUTION=256x106,CODECS="avc1.66.30",FRAME-RATE=24.000
channel_550172.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1650064,AVERAGE-BANDWIDTH=3031000,RESOLUTION=640x266,CODECS="avc1.66.30",FRAME-RATE=24.000
channel_1650064.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2749539,AVERAGE-BANDWIDTH=3031000,RESOLUTION=1280x534,CODECS="avc1.66.30",FRAME-RATE=24.000
channel_2749539.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=4947980,AVERAGE-BANDWIDTH=3031000,RESOLUTION=1920x800,CODECS="avc1.66.30",FRAME-RATE=24.000
channel_4947980.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=8247438,AVERAGE-BANDWIDTH=3031000,RESOLUTION=1920x800,CODECS="avc1.66.30",FRAME-RATE=24.000
channel_8247438.m3u8`;

const master_10_channel = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:6
#EXT-X-MEDIA-SEQUENCE:1
#EXTINF:6.000,
channel_10_1.ts
#EXTINF:6.000,
channel_10_2.ts
#EXTINF:6.000,
channel_10_3.ts
#EXTINF:6.000,
channel_10_4.ts
#EXTINF:6.000,
channel_10_5.ts
#EXTINF:6.000,
channel_10_6.ts
#EXTINF:6.000,
channel_10_7.ts
#EXTINF:6.000,
channel_10_8.ts
#EXTINF:6.000,
channel_10_9.ts`;

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
      this.concurrentWorkers = parseInt(process.env.DEFAULT_UPLOAD_CONCURRENCY) || 10;
    }
    this.outputDestination = params.dest;
    this.active = true;
    this.sourcePrevMseq = 0;
    this.collectedSegments = {
      video: {},
      audio: {},
      subtitle: {},
    };

    const mediaPackageEndpoints = [
      {
        url: "https://033c20e6acf79d8f.mediapackage.eu-north-1.amazonaws.com/in/v2/8bca7c5e42d94296896a317c72714087/8bca7c5e42d94296896a317c72714087/channel",
        username: "1ebc30055d804b32b36325bab629f8f3",
        password: "ee179b8d5d4b40a2ab8eab2fd9c5a536",
      },
      // {
      //   url: "https://1787c7637adb4d19.mediapackage.eu-north-1.amazonaws.com/in/v2/8bca7c5e42d94296896a317c72714087/106d0a9077164f1c8c3df3c9af714c21/channel",
      //   username: "283924cb81914516bc15f4f26e495579",
      //   password: "ea22805741844bb89db0dd1b8291657b",
      // },
    ];

    const putToMediaPackage = async function (mediaPackageEndpoints, fileName, data) {
      let status = null;
      for (let i = 0; i < mediaPackageEndpoints.length; i++) {
        const url = new URL(mediaPackageEndpoints[i].url);
        const client = createClient(url.href.replace("/channel", ""), {
          username: mediaPackageEndpoints[i].username,
          password: mediaPackageEndpoints[i].password,
          authType: AuthType.Digest,
        });
        try {
          // Try Upload manifest
          let bool = await client.putFileContents(fileName, data, {
            overwrite: true,
          });
          console.log(" webDAV PUT " + fileName, bool, mediaPackageEndpoints[i].username);
          status = bool;
        } catch (e) {
          console.error("(!): Trouble in 'putFileContents'", e);
          throw new Error(e);
        }
      }
      return status;
    };

    // const manifestUploader = async (item) => {
    //   try {
    //     await putToMediaPackage(item.mp_endpoints, item.file_name, item.data);
    //     return { message: `Manifest (${item.file_name}) uploaded...` };
    //   } catch (err) {
    //     console.error(err);
    //     return Promise.reject(err);
    //   }
    // };
    // this.m3u8Queue = fastq(manifestUploader, 5);

    // // eslint-disable-next-line no-unused-vars
    // const segmentUploader = async (item) => {
    //   try {
    //     const segURI = item.segment_uri;
    //     const endpoints = item.mp_endpoints;
    //     const fileName = item.file_name; //path.basename(segURI);

    //     //const segmentFileName = fileName.replace("master", "channel");
    //     debug("Inside: s3UploadSegment, ", fileName);

    //     fetch(segURI)
    //       .then((res) => res.buffer())
    //       .then(async (buffer) => {
    //         await putToMediaPackage(endpoints, fileName, buffer);
    //         return { message: "Segment uploaded..." };
    //       })
    //       .catch((err) => {
    //         throw new Error(err);
    //       });
    //   } catch (err) {
    //     console.error(err);
    //     return Promise.reject(err);
    //   }
    // };
    // this.segQueue = fastq(segmentUploader, 5);

    this.m3u8Queue = fastq(this.outputDestination.uploadMediaPlaylist.bind(this.outputDestination), this.concurrentWorkers);
    this.segQueue = fastq(this.outputDestination.uploadMediaSegment.bind(this.outputDestination), this.concurrentWorkers);

    // .----------------------------------------------.
    // *** Processing new recorder segment items ***  |
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
          `[${this.sessionId}]: HLSRecorder event triggered. Recieved new segments. Totals amount per variant=${
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
          BottomSegs = GetOnlyNewestSegments(data.allPlaylistSegments, this.previousMseq, this.previousSegCount, data.type);
        }
        let bw = Object.keys(BottomSegs["video"])[0];

        // Stop recorder if source became a VOD
        if (data.type === PlaylistType.VOD) {
          debug(`[${this.sessionId}]: Stopping HLSRecorder due to recording becoming a VOD`);
          // this.recorder.PlaylistType = PlaylistType.VOD
          await this.StopHLSRecorder();
        }

        // Add new editions to s3 collection
        PushSegments(this.sessionId, this.collectedSegments, BottomSegs);

        // Update Previous Source Mseq and SegCount
        this.previousMseq = BottomSegs["video"][bw].mediaSeq;
        this.previousSegCount = data.allPlaylistSegments["video"][bw].segList.length;

        debug(`[${this.sessionId}]: Trying to Push all new hlsrecorder segments to Media Package: ${this.created}`);
        // Upload Master If not already done...
        if (!this.masterM3U8) {
          try {
            console.log("[debug]: ___GONNA TRY upload master manifest___");
            this.masterM3U8 = this.outputDestination.generateMultiVariantPlaylist(this.hlsrecorder.masterManifest);
            await this.outputDestination.uploadMediaPlaylist({
              fileName: "channel.m3u8",
              fileData: better_master,
            });
            console.log(3, "await this.outputDestination.uploadMediaPlaylist");
            console.log("PUT Master Complete");
          } catch (error) {
            console.error("(!) Issue with webDAV");
            throw new Error(error);
          }
        }
        let SegmentsWithNewURL;
        let tasksSegments;
        try {
          console.log(4, "await this._UploadAllSegments");
          // Upload all newest segments to S3 Bucket
          tasksSegments = await this._UploadAllSegments(this.segQueue, BottomSegs);
          // Make Segment Urls formatted and ready for Manifest Generation
          SegmentsWithNewURL = ReplaceSegmentURLs(this.collectedSegments);
          // Let the Workers Work!
          const resultsSegments = [];
          for (let result of tasksSegments) {
            console.log(5, "await result");
            resultsSegments.push(await result);
          }
          debug(`[${this.sessionId}]: Finished uploading all segments!`);

          if (this.atFirstIncrement || this.sourceIsEvent || this.active) {
            // Upload Recording Playlist Manifest to S3 Bucket
            let tasksManifest = await this._UploadAllManifest(this.m3u8Queue, SegmentsWithNewURL, this.segmentTargetDuration);
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
        console.log(6, "this.atFirstIncrement = false;");
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

  isActive() {
    return this.active;
  }

  async StopHLSRecorder() {
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

  async _UploadAllSegments(taskQueue, segments) {
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

  async _UploadAllManifest(taskQueue, segments, targetDuration) {
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
        const playlistToBeUploaded: string = playlistM3u8.replaceAll("master", "channel");
        let stri = playlistToBeUploaded.split(/#EXT-X-MEDIA-SEQUENCE:(\d)/);
        let head =
          "#EXTM3U\n" +
          "#EXT-X-VERSION:3\n" +
          "#EXT-X-TARGETDURATION:" +
          generatorOptions.targetDuration +
          "\n" +
          "#EXT-X-MEDIA-SEQUENCE:" +
          generatorOptions.mseq;
        head += stri[2];
        const name = `channel_${bw}.m3u8`;
        let item = {
          fileName: name,
          fileData: head,
        };
        tasks.push(taskQueue.push(item));
      });
    });
    /*
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
