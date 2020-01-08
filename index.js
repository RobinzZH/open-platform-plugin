const axios = require("axios");
const { signature } = require("./sig");
const URL = require("url");
const { encode } = require("./encrypt");

const apiDomain = "openapi.tswjs.org";
const url = `https://${apiDomain}/v1/log/report`;

const handleProxy = () => {
  if ((process.env.no_proxy || "").includes(apiDomain)
  || (process.env.NO_PROXY || "").includes(apiDomain)) {
    return;
  }

  if ((process.env.http_proxy || "").includes("127.0.0.1:12759")
  || (process.env.HTTP_PROXY || "").includes("127.0.0.1:12759")
  || (process.env.http_proxy || "").includes("127.0.0.1:12639")
  || (process.env.HTTP_PROXY || "").includes("127.0.0.1:12639")) {
    process.env.no_proxy = process.env.no_proxy 
      ? `${process.env.no_proxy},${apiDomain}`
      : apiDomain;
  }
}

module.exports = (event, config) => {
  handleProxy();

  event.on("RESPONSE_CLOSE", (payload) => {
    const { req, res, context } = payload;

    context.captureRequests.map(item => {
      // 适配一下，SN 需要以 1 开头，否则会丢失序号为 0 的抓包
      item.SN += 1;
      item.resultCode = item.statusCode;
      item.url = item.path;
    });

    context.currentRequest.resultCode = context.currentRequest.statusCode;
    context.currentRequest.url = context.currentRequest.path;

    const data = {
      type: "alpha",
      appid: config.appid,
      appkey: config.appkey,
      now: Date.now(),
  
      logText: encode(config.appid, config.appkey, context.log.arr.join("\r\n")),
      logJson: encode(config.appid, config.appkey, {
        curr: context.currentRequest,
        ajax: context.captureRequests
      }),

      key: "522856232",
      mod_act: "",
      ua: req.headers["user-agent"],
      userip: context.clientIp,
      host: context.host,
      pathname: req.url,
      ext_info: '',
      statusCode: context.resultCode,
      group: ""
    }
  
    data.sig = signature({
      pathname: URL.parse(url).pathname,
      method: 'POST',
      data,
      appkey: config.appkey
    });
  
    axios.post(url, data, {
      responseType: "json"
    }).then(d => {
      console.log(d.data);
    }).catch(e => {
      console.error(e);
    })
  })
}