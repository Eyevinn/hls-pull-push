const { CreateHarvestJobRequest } = require("@aws-sdk/client-mediapackage");

//let uu = new URL("fenfoiwnvnvnow.vsv.r.rv.vs.");

class Test {
  constructor() {
    this.text = {};
    this.someFn = (key) => {
      let value = this.text[key];
      console.log(value);
    };
  }

  AddKey(text) {
    // <------ remove the static
    console.log("adding key:", text);
    this.text[text] = 100;
  }
}

let test = new Test();

test.AddKey("EYEVINN");
try {
  test.someFn("EYEVINN");
} catch (e) {
  console.error(e);
}

let ii = `#EXTM3U
#EXT-X-VERSION:6
## Created with Eyevinn HLS Recorder library (version=0.3.2)
##    https://www.npmjs.com/package/@eyevinn/hls-recorder
#EXT-X-PLAYLIST-TYPE:EVENT
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-TARGETDURATION:6
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:6.000,
channel_8247438_20.ts`;

let stri = ii.split(/#EXT-X-MEDIA-SEQUENCE:(\d)/);
let head =
  "#EXTM3U\n" + "#EXT-X-VERSION:3\n" + "#EXT-X-TARGETDURATION:6\n" + "#EXT-X-MEDIA-SEQUENCE:1";
head += stri[2];
console.log(head);
/***
 *  TODO: Update manifest Mseq, when sliding window.
 */
