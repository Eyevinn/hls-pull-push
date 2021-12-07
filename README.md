Node library for building a service to pull Live HLS and push to a WebDAV endpoint

## Installation

```
npm install --save @eyevinn/hls-pull-push
```

## Usage

```javascript
import { HLSPullPush, MediaPackageOutput, S3Output } from "@eyevinn/hls-pull-push";

const pullPushService = new HLSPullPush();
pullPushService.registerPlugin("mediapackage", new MediaPackageOutput());
pullPushService.registerPlugin("s3", new S3Output({ 
  region: "eu-north-1",
  access_key_id: "***"
  secret_access_key: "***",
}));
pullPushService.listen(process.env.PORT || 8080);
```
>S3Output plugin is not yet implemented
## API

| ENDPOINT                      | METHOD | DESCRIPTION                                 |
| ----------------------------- | ------ | ------------------------------------------- |
| `/api/docs`                   | GET    | Live API documentation                      |
| `/api/v1/fetcher`             | POST   | Create a fetcher and start to pull and push |
| `/api/v1/fetcher`             | GET    | List of active fetchers                     |
| `/api/v1/fetcher/{fetcherId}` | DELETE | Stop an active fetcher                      |

### POST JSON Template

```
{
  "name": <string>,       // Name of session
  "url": <string>,        // Reachable HTTP url to HLS live stream
  "output": <string>,     // Output plugin name 
  "payload": <json>,      // Output plugin specific destination payload
  "concurrency": <number> // [OPTIONAL] Number of parallel downloads & uploads, default is 16
  "windowSize": <number>  // [OPTIONAL] Window size (seconds) for Media Playlist uploaded to output, default is 120
}
```

Example MediaPackage:
```
{
  "name": "eyevinn",
  "url": "https://demo.vc.eyevinn.technology/channels/eyevinn/master.m3u8",
  "output": "mediapackage",
  "payload": {
    "ingestUrls": [ { 
      "url": "https://033c20e6acf79d8f.mediapackage.eu-north-1.amazonaws.com/in/v2/8bca7c5e42d94296896a317c72714086/8bca7c5e42d94296896a317c72714abc/channel",
      "username": "***",
      "password": "***"
    } ]
  }
}
```

Example S3:
```
{
  "name": "s3cache",
  "url": "https://demo.vc.eyevinn.technology/channels/eyevinn/master.m3u8",
  "output": "s3",
  "concurrency": 10,
  "windowSize": 300,
  "payload": {
    "bucket": "origin-live"
  }
}
```
## Debugging
The service uses the debugging utility `debug`. To see relavant logs from the service, run with env `DEBUG` set to `hls-*`. 

## Input HLS: Supported Types and Expected Behaviours
HLS streams using fMP4 and encryption are not supported in this service currently.
With that in mind, the service can take in HLS streams that are of the playlist types LIVE, EVENT or VOD.

When the HLS stream is a LIVE type, then the default `windowSize` will be set to 120 seconds, unless `windowSize` is present in the POST JSON. 
If so then the default will be overwritten by the value found in the POST JSON.

When the HLS stream is an EVENT type, then the default `windowSize` is set to `-1` (infinite). It will try to have a growing window matching the source.
The service will assume that the HLS EVENT stream will eventually end/become a VOD. However, if `windowSize` is present in the POST JSON, 
then the default will be overwritten by the value found in the POST JSON.  

When the HLS stream is a VOD type, then the fetcher session will only need to pull and push once. The service will try to push all segments to the output at once (limited by the set `concurrency` number). Therefor, the fetcher session will not count as an active fetcher, and will not show up in the list obtained from the `GET/api/v1/fetcher` endpoint.

## Limitations and Future Work
- Currently, there are no operations in place to check if the request destination is already in use by another session. 
Allowing for multiple sessions uploading to the same destination and overwriting each others files.
- Until fixed, when HLS source is type EVENT but still has a sliding window, no fetching occurs.
- Fetcher List in GET endpoint do not communicate if fetcher sessions are faulty or not, only if they are active.
- S3Output plugin is not yet implemented.


# About Eyevinn Technology

Eyevinn Technology is an independent consultant firm specialized in video and streaming. Independent in a way that we are not commercially tied to any platform or technology vendor.

At Eyevinn, every software developer consultant has a dedicated budget reserved for open source development and contribution to the open source community. This give us room for innovation, team building and personal competence development. And also gives us as a company a way to contribute back to the open source community.

Want to know more about Eyevinn and how it is to work here. Contact us at work@eyevinn.se!