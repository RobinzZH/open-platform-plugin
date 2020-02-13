const axios = require("axios");
const { signature } = require("./sig");
const URL = require("url");
const { encode } = require("./encrypt");
const moment = require('moment')

const apiDomain = "openapi.tswjs.org";
const url = `http://${apiDomain}/v1/log/report`;

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

  event.on("RESPONSE_FINISH", (payload) => {
    const { req, res, context } = payload;
    const { captureRequests, currentRequest } = context;

    captureRequests.map(item => {
      // 适配一下，SN 需要以 1 开头，否则会丢失序号为 0 的抓包
      item.SN += 1;
      item.resultCode = item.statusCode;
      item.url = item.path;
    });

    currentRequest.resultCode = currentRequest.statusCode;
    currentRequest.url = currentRequest.path;

    const responseHeaders = (() => {
      const headers = {};
      res.getHeaderNames().forEach(name => {
        headers[name] = res.getHeader(name);
      })
      return headers;
    })();

    const loggerText = [`${moment().format("YYYY-MM-DD HH:mm:ss.SSS")} ${req.method} ${
      currentRequest.protocol.toLowerCase()
    }://${currentRequest.host}${currentRequest.path}`]
      .concat(context.log.arr)
      .concat(`\r\nresponse ${currentRequest.resultCode} ${
        JSON.stringify(responseHeaders, null, 4)
      }`);

    const data = {
      type: "alpha",
      appid: config.appid,
      appkey: config.appkey,
      now: Date.now(),
  
      logText: encode(config.appid, config.appkey, loggerText.join("\r\n")),
      logJson: encode(config.appid, config.appkey, {
        curr: currentRequest,
        ajax: captureRequests
      }),

      key: "demo",
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
