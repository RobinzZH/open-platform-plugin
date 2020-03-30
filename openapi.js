const axios = require("axios");
const URL = require("url");
const { signature } = require("./sig");

/**
 * tswjs开放平台openapi接口封装
 */
module.exports = class OpenApi {
  /**
   * 调用openapi依赖的参数
   * @param {*} opt 参数对象
   * @param {string} opt.appid 应用 id
   * @param {string} opt.appkey 应用 key
   * @param {string} opt.apiDomain 开放平台域名
   */
  constructor(opt = {}) {
    this.appid = opt.appid
    this.appkey = opt.appkey;
    this.h5testSyncUrl = `${opt.apiDomain}/v1/h5test/sync`;
    this.h5testListUrl = `${opt.apiDomain}/openapi/h5test/list`;
    this.h5testSetUrl = `${opt.apiDomain}/openapi/h5test/set`;
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
}
