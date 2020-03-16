const axios = require("axios");
const URL = require("url");
const moment = require('moment');
const { signature } = require("./sig");
const { encode } = require("./encrypt");
const ip = require("ip");

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
  /**
   * @param {Object} config 配置对象
   * @param {String} config.appid 应用 id
   * @param {String} config.appkey 应用 key
   * @param {"never" | "always" | "proxied"} config.reportStrategy 上报策略
   * @param {Function} config.getUid 获取用户唯一标识
   * @param {Function} config.getProxyInfo 获取本机代理环境信息
   * @param {Boolean} httpDomain 是否使用 http 上报域名
   */
  constructor(config) {
    this.name = "OpenPlatformPlugin";
    this.appid = config.appid;
    this.appkey = config.appkey;
    this.reportStrategy = config.reportStrategy;
    this.reportStrategies = ["never", "always", "proxied"];
    this.proxyInfo = {};
    this.intranetIp = ip.address();
    this.apiDomain = `${config.httpDomain ? "http" : "https"}://openapi.tswjs.org`;
    this.logReportUrl = `${this.apiDomain}/v1/log/report`;
    this.h5testSyncUrl = `${this.apiDomain}/v1/h5test/sync`;

    // 默认给一个返回 undefined 的同步函数
    this.getUid = config.getUid || (() => {});
    // 默认给一个返回 undefined 的同步函数re
    this.getProxyInfo = config.getProxyInfo || (() => {});
  }

  /**
   * 插件初始化
   */
  async init(eventBus, config) {
    this.log("插件开始加载...");

    this.log("获取 proxyInfo 中...");
    const info = await this.getProxyInfo();
    if (info) {
      this.proxyInfo[this.intranetIp] = info;
    }

    this.log("断言参数类型是否符合预期...");
    this.assertParams();

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

      switch (this.reportStrategy) {
        case "always":
          this.log(`请求结束日志上报，因为 reportStrategy 为 always`);
          return this.reportLog(req, res, context);
        case "never":
          this.log(`请求结束日志不上报，因为 reportStrategy 为 never`);
          return;
        case "proxied":
          if (context.proxyIp) {
            this.log(`请求结束日志上报，因为这个请求被代理到 ${context.proxyIp}`);
            return this.reportLog(req, res, context);
          } else {
            this.log(`请求结束日志不上报，因为这个请求没有被代理过`);
            return;
          }
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

    if (this.reportStrategies.indexOf(this.reportStrategy) === -1) {
      throw new Error(`参数 reportStrategy 函数必须是为 ${this.reportStrategies} 其中一个`);
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
    const proxyInfo = this.proxyInfo[this.intranetIp];
  
    if (!proxyInfo) return this.log(`不允许通过代理访问本机器，不上报开放平台`);
  
    const logText = `${this.intranetIp}:${proxyInfo.port ? proxyInfo.port : '80'}`;
    let logJson = Object.assign({
      ip: this.intranetIp,
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
      pathname: URL.parse(this.logReportUrl).pathname,
      method: 'POST',
      data,
      appkey: this.appkey
    });
  
    await axios.post(this.logReportUrl, data, {
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
      pathname: URL.parse(this.h5testSyncUrl).pathname,
      method: 'POST',
      data,
      appkey: this.appkey
    });

    await axios.post(this.h5testSyncUrl, data, {
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
      pathname: URL.parse(this.logReportUrl).pathname,
      method: 'POST',
      data,
      appkey: this.appkey
    });
  
    await axios.post(this.logReportUrl, data, {
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