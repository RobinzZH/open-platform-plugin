const axios = require("axios");
const URL = require("url");
const { signature } = require("./sig");
const { encode } = require("./encrypt");

/**
 * tswjs开放平台openapi接口封装
 */
class OpenApi {
  /**
   * 调用openapi依赖的参数
   * @param {*} options 参数对象
   * @param {string} options.appid 应用 id
   * @param {string} options.appkey 应用 key
   * @param {string} options.httpDomain 是否使用 http 上报域名
   */
  constructor(options = {}) {
    this.appid = options.appid
    this.appkey = options.appkey;
    this.apiDomain = `${options.httpDomain ? "http" : "https"}://openapi.tswjs.org`;

    this.logReportUrl = `${this.apiDomain}/v1/log/report`;
    this.h5testSyncUrl = `${this.apiDomain}/v1/h5test/sync`;
    this.h5testListUrl = `${this.apiDomain}/openapi/h5test/list`;
    this.h5testSetUrl = `${this.apiDomain}/openapi/h5test/set`;

    if (!this.appid) {
      throw new Error(`参数 appid 不能为空`);
    }

    if (!this.appkey) {
      throw new Error(`参数 appkey 不能为空`)
    }
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
      method: "POST",
      data,
      appkey: this.appkey
    });

    return await axios
      .post(this.h5testSyncUrl, data, {
        responseType: "json"
      })
      .then(d => {
        if (d.data.code !== 0) throw new Error(d.data.message);
        return d.data.data
      })
      .catch(e => {
        throw new Error(`代理名单更新失败: ${e.message}`);
      });
  }
  /**
   * 获取测试环境列表
   * @param {String} group 测试环境分组，默认获取全部环境
   */
  async listTestEnv(group) {
    const data = {
      appid: this.appid,
      now: Date.now()
    };

    if (group) {
      data.group = group
    }

    data.sig = signature({
      pathname: URL.parse(this.h5testListUrl).pathname,
      method: "POST",
      data,
      appkey: this.appkey
    });

    return await axios
      .post(this.h5testListUrl, data, {
        responseType: "json"
      })
      .then(d => {
        if (d.data.code !== 0) throw new Error(d.data.message);
        return d.data.data
      })
      .catch(e => {
        throw new Error(`获取测试环境列表失败: ${e.message}`);
      });
  }
  /**
   * 添加白名单
   * @param {string} uin 白名单号码 e.g 12345
   * @param {string} val 环境列表，或者是 alpha 只染色 e.g 127.0.0.1:8080 或者 alpha
   */
  async addTestUid(uin, val) {
    const data = {
      appid: this.appid,
      action: 'add',
      uin,
      val,
      now: Date.now()
    };

    data.sig = signature({
      pathname: URL.parse(this.h5testSetUrl).pathname,
      method: "POST",
      data,
      appkey: this.appkey
    });

    return await axios
      .post(this.h5testSetUrl, data, {
        responseType: "json"
      })
      .then(d => {
        if (d.data.code !== 0) throw new Error(d.data.message);
        return d.data.data
      })
      .catch(e => {
        throw new Error(`添加测试号码失败: ${e.message}`);
      });
  }

  /**
   * 清除测试环境对应白名单号码
   * @param {String[]} uinList 白名单号码列表
   */
  async removeTestUid(uinList) {
    const data = {
      appid: this.appid,
      action: 'del',
      uin: uinList.join(','),
      now: Date.now()
    };

    data.sig = signature({
      pathname: URL.parse(this.h5testSetUrl).pathname,
      method: "POST",
      data,
      appkey: this.appkey
    });

    return await axios
      .post(this.h5testSetUrl, data, {
        responseType: "json"
      })
      .then(d => {
        if (d.data.code !== 0) throw new Error(d.data.message);
        return d.data.data
      })
      .catch(e => {
        throw new Error(`删除测试号码失败: ${e.message}`);
      });
  }

  /**
   * 上报代理环境
   * @param {*} info 
   */
  async reportProxyEnv(info) {
    const { logText, logJson } = info;

    if (!logText) {
      throw new Error("logText 参数不可以为空");
    }

    if (!logJson) {
      throw new Error("logJson 参数不可以为空");
    }

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
    };

    data.sig = signature({
      pathname: URL.parse(this.logReportUrl).pathname,
      method: 'POST',
      data,
      appkey: this.appkey
    });
  
    return axios.post(this.logReportUrl, data, {
      responseType: "json"
    }).then(d => {
      if (d.data.code !== 0) throw new Error(d.data.message);
    }).catch(e => {
      throw e;
    });
  }

  /**
   * 上报日志
   */
  async reportLog(info) {
    const { logText, logJson, key, ua, userip, host, pathname, statusCode} = info;

    const data = {
      type: "alpha",
      appid: this.appid,
      appkey: this.appkey,
      now: Date.now(),
  
      logText: encode(this.appid, this.appkey, logText),
      logJson: encode(this.appid, this.appkey, logJson),
  
      key,
      mod_act: "",
      ua,
      userip,
      host,
      pathname,
      ext_info: '',
      statusCode,
      group: ""
    };

    data.sig = signature({
      pathname: URL.parse(this.logReportUrl).pathname,
      method: 'POST',
      data,
      appkey: this.appkey
    });
  
    return axios.post(this.logReportUrl, data, {
      responseType: "json"
    }).then(d => {
      if (d.data.code !== 0) throw new Error(d.data.message);
    }).catch(e => {
      this.log(`上报日志失败: ${e.message}`);
    })
  }
}

module.exports = {
  OpenApi
}
