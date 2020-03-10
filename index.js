const axios = require("axios");
const URL = require("url");
const moment = require('moment');
const { signature } = require("./sig");
const { encode } = require("./encrypt");
const ip = require('ip');

const apiDomain = "openapi.tswjs.org";
const url = `https://${apiDomain}/v1/log/report`;
const h5testSyncUrl = `https://${apiDomain}/v1/h5test/sync`;

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

handleProxy();

global.eventBus.on("REQUEST_START", (payload) => {
  const { req, context } = payload;
  const proxyInfo = instance.config.proxyInfo;

  context.uid = instance.config.getUid(req);

  for( let proxyIp of Object.keys(proxyInfo) ){
    if(proxyInfo[proxyIp].alphaList.indexOf(context.uid) !== -1){
      context.proxyIp = proxyIp;
      context.proxyPort = proxyInfo[proxyIp].port || "80";
      break;
    }
  }
})

global.eventBus.on("RESPONSE_FINISH", (payload) => {
  const { req, res, context } = payload;

  if(context.uid === "") return console.log("Not set uid");
  if(instance.config.reportList === false) return console.log("Not open report");
  if(instance.config.reportList === true ||
    (instance.config.reportList instanceof Array && instance.config.reportList.indexOf(context.uid) !== -1)) 
    return instance.reportLog(req, res, context);

  return console.log("Current user not in reportList");
})

class OpenPlatformPlugin {
  constructor(config) {
    this.name = 'OpenPlatformPlugin';
    this.config = Object.assign({
      appid: "",
      appkey: "",
      proxyInfo: {},
      reportList: false,
      getUid: async () => {},
      getProxyInfo: async () => {},
      getReportList: async () => {},
    }, config);
    instance = this;

    const promiseOrResult4Report = this.config.getReportList();
    if (promiseOrResult4Report instanceof Promise) {
      promiseOrResult4Report.then(d => {
        this.config.reportList = d;
      }).catch(e => {
        console.error(e);
      });
    } else {
      this.config.reportList = promiseOrResult4Report;
    }

    const promiseOrResult4Proxy = this.config.getProxyInfo();
    if (promiseOrResult4Proxy instanceof Promise) {
      promiseOrResult4Proxy.then(d => {
        this.updateProxyEnvByFn(d);
      }).catch(e => {
        console.error(e);
      });
    } else {
      this.updateProxyEnvByFn(promiseOrResult4Proxy);
    }

    // 周期性更新代理名单
    setInterval(()=>{
      this.updateProxyEnvByCloud();
    }, 60000);
  }
  reportProxyEnv = () => {
    console.log('reportProxyEnv')
    const proxyInfos = this.config.proxyInfo;
    if(!proxyInfos) return console.log('Not set proxy env');
  
    const intranetIp = ip.address();
    const proxyInfo = proxyInfos[intranetIp];
  
    if(!proxyInfo) return console.log('Not set current machine as proxy env');
  
    const logText = `${intranetIp}:${proxyInfo.port ? proxyInfo.port : '80'}`;
    let logJson = Object.assign({
      ip: intranetIp,
      port: proxyInfo.port || 80,
      time: new Date().toGMTString(),
      name: '',
      group: 'unknown',
      desc: '',
      order: 0,
      owner: '',
    }, proxyInfo);
    const data = {
      type: 'alpha',
      logText: encode(this.config.appid, this.config.appkey, logText),
      logJson: encode(this.config.appid, this.config.appkey, logJson),
      key: 'h5test',
      group: 'tsw',
      mod_act: 'h5test',
      ua: '',
      userip: '',
      host: '',
      pathname: '',
      statusCode: '',
      appid: this.config.appid,
      appkey: this.config.appkey,
      now: Date.now(),
    }
  
    data.sig = signature({
      pathname: URL.parse(url).pathname,
      method: 'POST',
      data,
      appkey: this.config.appkey
    });
  
    axios.post(url, data, {
      responseType: "json"
    }).then(d => {
      console.log(d.data);
    }).catch(e => {
      console.error(e);
    })
  }

  updateProxyEnvByCloud = () => {
    console.log('updateProxyEnvByCloud')
    const data = {
      appid: this.config.appid,
      now: Date.now()
    };
    data.sig = signature({
      pathname: URL.parse(h5testSyncUrl).pathname,
      method: 'POST',
      data,
      appkey: this.config.appkey
    });

    axios.post(h5testSyncUrl, data, {
      responseType: "json"
    }).then(d => {
      console.log(d.data);
      let remoteProxyInfo = d.data.data;
      if(JSON.stringify(remoteProxyInfo) === "{}") return;
      const proxyInfo = this.config.proxyInfo;
      for(let uid of Object.keys(remoteProxyInfo)){
        const ip = remoteProxyInfo[uid].split(":")[0];
        if(!proxyInfo[ip]){
          proxyInfo[ip] = { alphaList: [uid] };
        }else if(proxyInfo[ip] && proxyInfo[ip].alphaList.indexOf(uid) === -1) {
          proxyInfo[ip].alphaList.push(uid);
        }else {
          return;
        }
      }
    }).catch(e => {
      console.error(e);
    })
  }

  updateProxyEnvByFn = (extendProxyInfo) => {
    console.log('updateProxyEnvByFn');
    if(JSON.stringify(extendProxyInfo) === "{}") return;
    const proxyInfo = this.config.proxyInfo;

    for(let ip of Object.keys(extendProxyInfo)){
      if(proxyInfo[ip] && proxyInfo[ip].alphaList){
        const newAlphaList = Array.from(new Set( extendProxyInfo[ip].alphaList.concat(proxyInfo[ip].alphaList) ));
        proxyInfo[ip] = Object.assign(proxyInfo[ip], extendProxyInfo[ip]);
        proxyInfo[ip].alphaList = newAlphaList;
      }else if(proxyInfo[ip] && !proxyInfo[ip].alphaList) {
        proxyInfo[ip] = Object.assign(proxyInfo[ip], extendProxyInfo[ip]);
      }else {
        proxyInfo[ip] = extendProxyInfo[ip];
      }
    }

    this.reportProxyEnv();
  }

  reportLog(req, res, context) {
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
      appid: this.config.appid,
      appkey: this.config.appkey,
      now: Date.now(),
  
      logText: encode(this.config.appid, this.config.appkey, loggerText.join("\r\n")),
      logJson: encode(this.config.appid, this.config.appkey, {
        curr: currentRequest,
        ajax: captureRequests
      }),
  
      key: context.uid,
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
      appkey: this.config.appkey
    });
  
    axios.post(url, data, {
      responseType: "json"
    }).then(d => {
      console.log(d.data);
    }).catch(e => {
      console.error(e);
    })
  }
}

let instance;

module.exports = OpenPlatformPlugin;