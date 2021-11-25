Node library for building a service to pull Live HLS and push to a WebDAV endpoint

## Installation

```
npm install --save @eyevinn/hls-pull-push
```

## Usage

```
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
  "name": <string>,    // Name of session
  "url": <string>,     // Reachable HTTP url to HLS live stream
  "output": <string>,  // Output plugin name 
  "payload": <json>,   // Output plugin specific destination payload
}
```

Example MediaPackage:
```
{
  "name": "eyevinn",
  "url": "https://demo.vc.eyevinn.technology/channels/eyevinn/master.m3u8",
  "output": "mediapackage",
  "payload": {
    "ingestUrls [ { 
      "url": "https://033c20e6acf79d8f.mediapackage.eu-north-1.amazonaws.com/in/v2/8bca7c5e42d94296896a317c72714087/8bca7c5e42d94296896a317c72714087/channel",
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
  "payload": {
    "bucket": "origin-live"
  }
}
```

# About Eyevinn Technology

Eyevinn Technology is an independent consultant firm specialized in video and streaming. Independent in a way that we are not commercially tied to any platform or technology vendor.

At Eyevinn, every software developer consultant has a dedicated budget reserved for open source development and contribution to the open source community. This give us room for innovation, team building and personal competence development. And also gives us as a company a way to contribute back to the open source community.

Want to know more about Eyevinn and how it is to work here. Contact us at work@eyevinn.se!