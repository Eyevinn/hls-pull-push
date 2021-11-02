Node library for building a service to pull Live HLS and push to a WebDAV endpoint

## Installation

```
npm install --save @eyevinn/hls-pull-push
```

## Usage

```
const { HLSPullPush, WebDAV } = require("@eyevinn/hls-pull-push");

const destPlugin = new WebDAV({
  destination: "webdav://destination",
  username: USERNAME,
  password: PASSWORD
});
const pullPushService = new HLSPullPush({
  dest: destPlugin
});
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
  "name": <string>,  // Name of session
  "url": <string>,   // Reachable HTTP url to HLS live stream
  "dest": IDestPayload,  // Destination plugin specific destination payload
}
```

# About Eyevinn Technology

Eyevinn Technology is an independent consultant firm specialized in video and streaming. Independent in a way that we are not commercially tied to any platform or technology vendor.

At Eyevinn, every software developer consultant has a dedicated budget reserved for open source development and contribution to the open source community. This give us room for innovation, team building and personal competence development. And also gives us as a company a way to contribute back to the open source community.

Want to know more about Eyevinn and how it is to work here. Contact us at work@eyevinn.se!