const axios = require("axios");
const URL = require("url");
const moment = require('moment');
const { signature } = require("./sig");
const { encode } = require("./encrypt");
const ip = require("ip");

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

class OpenPlatformPlugin {
  constructor(config) {
    this.name = "OpenPlatformPlugin";
    this.appid = config.appid;
    this.appkey = config.appkey;
    this.reportList = false;
    this.proxyInfo = {};

    // 默认给一个返回 undefined 的同步函数
    this.getUid = config.getUid || (() => {});
    // 默认给一个返回 {} 的同步函数
    this.getProxyInfo = config.getProxyInfo || (() => ({}));
    // 默认给一个返回 false 的同步函数
    this.getReportList = config.getReportList || (() => false);
  }

  /**
   * 插件初始化
   */
  async init(eventBus, config) {
    this.log("插件开始加载...");

    this.log("获取 reportList 中...");
    this.reportList = await this.getReportList();
    this.log("获取 proxyInfo 中...");
    this.proxyInfo = await this.getProxyInfo();

    this.log("断言参数类型是否符合预期...");
    this.assertParams();

    this.extendProxyInfo(this.proxyInfo);
    this.log("上传 proxyInfo 中...");
    await this.reportProxyEnv();

    /**
     * 请求开始时，提取 uid
     */
    eventBus.on("REQUEST_START", (payload) => {
      const { req, context } = payload;
    
      context.uid = this.getUid(req);
    
      for (const proxyIp of Object.keys(this.proxyInfo)) {
        if (this.proxyInfo[proxyIp].alphaList.indexOf(context.uid) !== -1) {
          context.proxyIp = proxyIp;
          context.proxyPort = this.proxyInfo[proxyIp].port || "80";
          break;
        }
      }
    })
    
    /**
     * 响应结束时，进行日志上报
     */
    eventBus.on("RESPONSE_FINISH", (payload) => {
      const { req, res, context } = payload;
    
      if (!context.uid) {
        this.log(`请求结束日志不上报，因为 uid 为空或者 undefined`);
        return;
      }

      if (this.reportList === false) {
        this.log(`请求结束日志不上报，因为 reportList 为 false`);
        return;
      }

      if (this.reportList === true) {
        this.log(`请求结束日志上报，因为 reportList 为 true`);
        return this.reportLog(req, res, context);
      }

      if (Array.isArray(this.reportList)
        && this.reportList.indexOf(context.uid) !== -1) {
        this.log(`请求结束日志上报，因为用户 ${context.uid} 在 reportList 中`);
        return this.reportLog(req, res, context);
      }
    })

    await this.updateProxyEnvByCloud();

    // 周期性更新代理名单
    setInterval(()=>{
      this.log("从开放平台同步测试号码（频率为 1min）...");
      this.updateProxyEnvByCloud();
    }, 60000);

    this.log("插件加载完毕")
  }

  assertParams() {
    if (!this.appid) {
      throw new Error(`参数 appid 不能为空`);
    }

    if (!this.appkey) {
      throw new Error(`参数 appkey 不能为空`)
    }

    if (typeof this.reportList !== "boolean"
      && !Array.isArray(this.reportList)) {
      throw new Error(`参数 getReportList 函数必须返回布尔值或者字符串数组`)
    }

    // TODO: 这里应该使用 joi 来进行更加详细的断言
    if (typeof this.proxyInfo !== "object") {
      throw new Error(`参数 getProxyInfo 函数必须返回一个对象`)
    }
  }

  /**
   * 上报代理环境
   */
  async reportProxyEnv() {
    const intranetIp = ip.address();
    const proxyInfo = this.proxyInfo[intranetIp];
  
    if (!proxyInfo) return this.log(`不允许通过代理访问本机器，不上报开放平台`);
  
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
      logText: encode(this.appid, this.appkey, logText),
      logJson: encode(this.appid, this.appkey, logJson),
      key: 'h5test',
      group: 'tsw',
      mod_act: 'h5test',
      ua: '',
      userip: '',
      host: '',
      pathname: '',
      statusCode: '',
      appid: this.appid,
      appkey: this.appkey,
      now: Date.now(),
    }
  
    data.sig = signature({
      pathname: URL.parse(url).pathname,
      method: 'POST',
      data,
      appkey: this.appkey
    });
  
    await axios.post(url, data, {
      responseType: "json"
    }).then(d => {
      if (d.data.code !== 0) throw new Error(d.data.message);
    }).catch(e => {
      this.log(`上报代理环境失败: ${e.message}`);
    })
  }

  /**
   * 从开放平台同步代理名单
   */
  async updateProxyEnvByCloud() {
    const data = {
      appid: this.appid,
      now: Date.now()
    };

    data.sig = signature({
      pathname: URL.parse(h5testSyncUrl).pathname,
      method: 'POST',
      data,
      appkey: this.appkey
    });

    await axios.post(h5testSyncUrl, data, {
      responseType: "json"
    }).then(d => {
      if (d.data.code !== 0) throw new Error(d.data.message);

      const remoteProxyInfo = d.data.data;
      for(const uid of Object.keys(remoteProxyInfo)){
        const [ip] = remoteProxyInfo[uid].split(":");

        const data = {};
        data[ip] = { alphaList: [uid] };
        this.extendProxyInfo(data);
      }
    }).catch(e => {
      this.log(`代理名单更新失败: ${e.message}`);
    })
  }

  extendProxyInfo(extendProxyInfo) {
    for (const ip of Object.keys(extendProxyInfo)){
      if (this.proxyInfo[ip] && this.proxyInfo[ip].alphaList){
        const newAlphaList = Array.from(
          new Set(
            extendProxyInfo[ip].alphaList.concat(this.proxyInfo[ip].alphaList)
          )
        );

        this.proxyInfo[ip] = Object.assign(this.proxyInfo[ip], extendProxyInfo[ip]);
        this.proxyInfo[ip].alphaList = newAlphaList;
      } else if(this.proxyInfo[ip] && !this.proxyInfo[ip].alphaList) {
        this.proxyInfo[ip] = Object.assign(this.proxyInfo[ip], extendProxyInfo[ip]);
      } else {
        this.proxyInfo[ip] = extendProxyInfo[ip];
      }
    }
  }

  async reportLog(req, res, context) {
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
      appid: this.appid,
      appkey: this.appkey,
      now: Date.now(),
  
      logText: encode(this.appid, this.appkey, loggerText.join("\r\n")),
      logJson: encode(this.appid, this.appkey, {
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
      appkey: this.appkey
    });
  
    await axios.post(url, data, {
      responseType: "json"
    }).then(d => {
      if (d.data.code !== 0) throw new Error(d.data.message);

      this.log(`上报日志成功`);
    }).catch(e => {
      this.log(`上报日志失败: ${e.message}`);
    })
  }

  log(string) {
    console.debug(`[${this.name}]: ${string}`)
  }
}

module.exports = OpenPlatformPlugin;