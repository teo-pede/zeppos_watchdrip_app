import {json2str, str2json} from "../shared/data";
import {DebugText} from "../shared/debug";
import {getGlobal} from "../shared/global";
import {gettext as getText} from "i18n";
import {
    Colors,
    Commands,
    DATA_STALE_TIME_MS,
    DATA_TIMER_UPDATE_INTERVAL_MS,
    DATA_UPDATE_INTERVAL_MS,
    PROGRESS_ANGLE_INC,
    PROGRESS_UPDATE_INTERVAL_MS,
    USE_FILE_INFO_STORAGE,
    XDRIP_UPDATE_INTERVAL_MS,
} from "../utils/config/constants";
import {
    WATCHDRIP_ALARM_CONFIG,
    WATCHDRIP_ALARM_CONFIG_DEFAULTS,
    WATCHDRIP_CONFIG,
    WATCHDRIP_CONFIG_DEFAULTS,
    WATCHDRIP_CONFIG_LAST_UPDATE,
    WF_INFO,
    WF_INFO_DIR,
    WF_INFO_FILE,
    WF_INFO_LAST_UPDATE,
    WF_INFO_LAST_UPDATE_ATTEMPT,
    WF_INFO_LAST_UPDATE_SUCCESS,
    WF_SYSTEM_ALARM_ID
} from "../utils/config/global-constants";
import {
    BG_DELTA_TEXT,
    BG_STALE_RECT,
    BG_TIME_TEXT,
    BG_TREND_IMAGE,
    BG_VALUE_TEXT,
    COMMON_BUTTON_ADD_TREATMENT,
    COMMON_BUTTON_SETTINGS,
    CONFIG_PAGE_SCROLL,
    DEVICE_TYPE,
    IMG_LOADING_PROGRESS,
    MESSAGE_TEXT,
    RADIO_OFF,
    RADIO_ON,
    TITLE_TEXT,
    VERSION_TEXT,
} from "../utils/config/styles";

import * as fs from "./../shared/fs";
import {WatchdripData} from "../utils/watchdrip/watchdrip-data";
import {getDataTypeConfig, img} from "../utils/helper";
import {gotoSubpage} from "../shared/navigate";

const logger = DeviceRuntimeCore.HmLogger.getLogger("watchdrip_app");

const {messageBuilder} = getApp()._options.globalData;
const {appId} = hmApp.packageInfo();

/*
typeof DebugText
*/
var debug = null;
/*
typeof Watchdrip
*/
var watchdrip = null;

const GoBackType = {NONE: 'none', GO_BACK: 'go_back', HIDE_PAGE: 'hide_page', HIDE: 'hide'};
const PagesType = {
    MAIN: 'main',
    UPDATE: 'update',
    UPDATE_LOCAL: 'update_local',
    HIDE: 'hide',
    CONFIG: 'config',
    ADD_TREATMENT: 'add_treatment'
};
const FetchMode = {DISPLAY: 'display', HIDDEN: 'hidden'};

class Watchdrip {
    constructor() {
        this.timeSensor = hmSensor.createSensor(hmSensor.id.TIME);
        this.vibrate = hmSensor.createSensor(hmSensor.id.VIBRATE);
        this.globalNS = getGlobal();
        this.goBackType = GoBackType.NONE;

        this.system_alarm_id = null;
        this.lastInfoUpdate = 0;
        this.firstDisplay = true;
        this.lastUpdateAttempt = null;
        this.lastUpdateSucessful = false;
        this.updatingData = false;
        this.intervalTimer = null;
        this.updateIntervals = DATA_UPDATE_INTERVAL_MS;
        this.fetchMode = FetchMode.DISPLAY;

        this.readConfig();
        this.createWatchdripDir();
        debug.setEnabled(this.watchdripConfig.showLog);
    }

    start(data) {
        debug.log("start");
        debug.log(data);
        let pageTitle = '';
        this.goBackType = GoBackType.NONE;
        switch (data.page) {
            case PagesType.MAIN:
                let pkg = hmApp.packageInfo();
                pageTitle = pkg.name
                this.main_page();
                break;
            case PagesType.UPDATE:
                this.goBackType = GoBackType.HIDE;
                this.readAlarmConfig();
                this.watchdripAlarmConfig = {...this.watchdripAlarmConfig, ...data.params};
                this.saveAlarmConfig();
                this.fetch_page();
                break;
            case PagesType.UPDATE_LOCAL:
                this.goBackType = GoBackType.HIDE;
                this.readAlarmConfig();
                this.fetch_page();
                break;
            case PagesType.HIDE:
                this.hide_page();
                break;
            case PagesType.CONFIG:
                pageTitle = getText("settings");
                this.config_page();
                break;
            case PagesType.ADD_TREATMENT:
                pageTitle = getText("add_treatment");
                this.add_treatment_page()
                break;
        }

        if (pageTitle) {
            if (DEVICE_TYPE === "round") {
                this.titleTextWidget = hmUI.createWidget(hmUI.widget.TEXT, {...TITLE_TEXT, text: pageTitle})
            } else {
                hmUI.updateStatusBarTitle(pageTitle);
            }
        }
    }

    readConfig() {
        var configStr = hmFS.SysProGetChars(WATCHDRIP_CONFIG);
        if (!configStr) {
            this.watchdripConfig = WATCHDRIP_CONFIG_DEFAULTS;
            this.saveConfig();
        } else {
            try {
                this.watchdripConfig = str2json(configStr);
                this.watchdripConfig = {...WATCHDRIP_CONFIG_DEFAULTS, ...this.watchdripConfig}
            } catch (e) {

            }
        }
    }

    saveConfig() {
        hmFS.SysProSetChars(WATCHDRIP_CONFIG, json2str(this.watchdripConfig));
        hmFS.SysProSetInt64(WATCHDRIP_CONFIG_LAST_UPDATE, this.timeSensor.utc);
    }

    main_page() {
        hmSetting.setBrightScreen(60);
        hmApp.setScreenKeep(true);
        this.watchdripData = new WatchdripData(this.timeSensor);
        let pkg = hmApp.packageInfo();
        this.versionTextWidget = hmUI.createWidget(hmUI.widget.TEXT, {...VERSION_TEXT, text: "v" + pkg.version});
        this.messageTextWidget = hmUI.createWidget(hmUI.widget.TEXT, {...MESSAGE_TEXT, text: ""});
        this.bgValTextWidget = hmUI.createWidget(hmUI.widget.TEXT, BG_VALUE_TEXT);
        this.bgValTimeTextWidget = hmUI.createWidget(hmUI.widget.TEXT, BG_TIME_TEXT);
        this.bgDeltaTextWidget = hmUI.createWidget(hmUI.widget.TEXT, BG_DELTA_TEXT);
        this.bgTrendImageWidget = hmUI.createWidget(hmUI.widget.IMG, BG_TREND_IMAGE);
        this.bgStaleLine = hmUI.createWidget(hmUI.widget.FILL_RECT, BG_STALE_RECT);
        this.bgStaleLine.setProperty(hmUI.prop.VISIBLE, false);

        //for display tests
        // this.setMessageVisibility(false);
        // this.setBgElementsVisibility(true);
        // this.updateWidgets();
        // return;

        if (this.watchdripConfig.disableUpdates) {
            this.showMessage(getText("data_upd_disabled"));
        } else {
            if (this.readInfo()) {
                this.updateWidgets();
            }
            this.fetchInfo();
            this.startDataUpdates();
        }

        /*hmUI.createWidget(hmUI.widget.BUTTON, {
            ...COMMON_BUTTON_FETCH,
            click_func: (button_widget) => {
                this.fetchInfo();
            },
        });*/

        hmUI.createWidget(hmUI.widget.BUTTON, {
            ...COMMON_BUTTON_SETTINGS,
            click_func: (button_widget) => {
                gotoSubpage(PagesType.CONFIG);
            },
        });

        hmUI.createWidget(hmUI.widget.BUTTON, {
            ...COMMON_BUTTON_ADD_TREATMENT,
            click_func: (button_widget) => {
                gotoSubpage(PagesType.ADD_TREATMENT);
            },
        });
    }

    getConfigData() {
        let dataList = [];

        Object.entries(this.watchdripConfig).forEach(entry => {
            const [key, value] = entry;
            let stateImg = RADIO_OFF
            if (typeof value === "number"){
                stateImg = value + '.png'
            } else {
                if (value) {
                    stateImg = RADIO_ON
                }
            }
            dataList.push({
                key: key,
                name: getText(key),
                state_src: img('icons/' + stateImg)
            });
        });
        this.configDataList = dataList;

        let dataTypeConfig = [
            getDataTypeConfig(1, 0, dataList.length)
        ]
        return {
            data_array: dataList,
            data_count: dataList.length,
            data_type_config: dataTypeConfig,
            data_type_config_count: dataTypeConfig.length
        }
    }

    add_treatment_page() {
        //not implemented
    }

    config_page() {
        hmUI.setLayerScrolling(false);

        this.configScrollList = hmUI.createWidget(hmUI.widget.SCROLL_LIST,
            {
                ...CONFIG_PAGE_SCROLL,
                item_click_func: (list, index) => {
                    debug.log(index);
                    const key = this.configDataList[index].key
                    let val = this.watchdripConfig[key]
                    if (typeof val === "number"){
                        if (val < 4){
                            this.watchdripConfig[key] = val + 1
                        } else {
                            this.watchdripConfig[key] = 0
                        }
                    } else {
                        this.watchdripConfig[key] = !val;
                    }
                    this.saveConfig();
                    //update list
                    this.configScrollList.setProperty(hmUI.prop.UPDATE_DATA, {
                        ...this.getConfigData(),
                        //Refresh the data and stay on the current page. If it is not set or set to 0, it will return to the top of the list.
                        on_page: 1
                    })
                },
                ...this.getConfigData()
            });
    }

    startDataUpdates() {
        if (this.intervalTimer != null) return; //already started
        debug.log("startDataUpdates");
        this.intervalTimer = this.globalNS.setInterval(() => {
            this.checkUpdates();
        }, DATA_TIMER_UPDATE_INTERVAL_MS);
    }

    stopDataUpdates() {
        if (this.intervalTimer !== null) {
            //debug.log("stopDataUpdates");
            this.globalNS.clearInterval(this.intervalTimer);
            this.intervalTimer = null;
        }
    }

    isTimeout(time, timeout_ms) {
        if (!time) {
            return false;
        }
        return this.timeSensor.utc - time > timeout_ms;
    }

    handleRareCases() {
        let fetch = false;
        if (this.lastUpdateAttempt == null) {
            debug.log("initial fetch");
            fetch = true;
        } else if (this.isTimeout(this.lastUpdateAttempt, DATA_STALE_TIME_MS)) {
            debug.log("the side app not responding, force update again");
            fetch = true;
        }
        if (fetch) {
            this.fetchInfo();
        }
    }

    checkUpdates() {
        //debug.log("checkUpdates");
        this.updateTimesWidget();
        if (this.updatingData) {
            //debug.log("updatingData, return");
            return;
        }
        let lastInfoUpdate = this.readLastUpdate();
        if (!lastInfoUpdate) {
            this.handleRareCases();
        } else {
            if (this.lastUpdateSucessful) {
                if (this.lastInfoUpdate !== lastInfoUpdate) {
                    //update widgets because the data was modified outside the current scope
                    debug.log("update from remote");
                    this.readInfo();
                    this.lastInfoUpdate = lastInfoUpdate;
                    this.updateWidgets();
                    return;
                }
                if (this.isTimeout(lastInfoUpdate, this.updateIntervals)) {
                    debug.log("reached updateIntervals");
                    this.fetchInfo();
                    return;
                }
                const bgTimeOlder = this.isTimeout(this.watchdripData.getBg().time, XDRIP_UPDATE_INTERVAL_MS);
                const statusNowOlder = this.isTimeout(this.watchdripData.getStatus().now, XDRIP_UPDATE_INTERVAL_MS);
                if (bgTimeOlder || statusNowOlder) {
                    if (!this.isTimeout(this.lastUpdateAttempt, DATA_STALE_TIME_MS)) {
                        debug.log("wait DATA_STALE_TIME");
                        return;
                    }
                    debug.log("data older than sensor update interval");
                    this.fetchInfo();
                    return;
                }
                //data not modified from outside scope so nothing to do
                debug.log("data not modified");
            } else {
                this.handleRareCases();
            }
        }
    }

    fetch_page() {
        debug.log("fetch_page");
        hmUI.setStatusBarVisible(false);
        this.prepareNextAlarm();
        if (this.watchdripConfig.disableUpdates || !this.watchdripConfig.useAppFetch) {
            this.handleGoBack();
            return;
        }
        hmSetting.setBrightScreen(999);
        this.progressWidget = hmUI.createWidget(hmUI.widget.IMG, IMG_LOADING_PROGRESS);
        this.progressAngle = 0;
        this.stopLoader();
        this.fetchMode = FetchMode.HIDDEN;
        this.fetchInfo(this.watchdripAlarmConfig.fetchParams);
    }

    hide_page() {
        hmApp.setScreenKeep(false);
        //hmSetting.setBrightScreenCancel();
        hmSetting.setBrightScreen(1)
        hmSetting.setScreenOff();
        //hmApp.goBack();
        //hmApp.exit();
        hmApp.gotoHome();
    }

    fetchInfo(params = '') {
        try{
            debug.log("fetchInfo");
            let isDisplay = true;
            if (this.fetchMode === FetchMode.HIDDEN) {
                isDisplay = false;
            }

            this.resetLastUpdate();

            if (messageBuilder.connectStatus() === false) {
                debug.log("No BT Connection");
                if (isDisplay) {
                    this.showMessage(getText("status_no_bt"));
                } else {
                    this.handleGoBack();
                }
                return;
            }

            if (params === "") {
                params = WATCHDRIP_ALARM_CONFIG_DEFAULTS.fetchParams;
            }

            if (isDisplay) {
                this.showMessage(getText("connecting"));
            } else {
                this.startLoader();
            }
            this.updatingData = true;
            messageBuilder
                .request({
                    method: Commands.getInfo,
                    params: params,
                }, {timeout: 5000})
                .then((data) => {
                    debug.log("received data");
                    let {result: info = {}} = data;
                    //debug.log(info);
                    try {
                        if (info.error) {
                            debug.log("Error");
                            debug.log(info);
                            return;
                        }
                        let dataInfo = str2json(info);
                        this.lastInfoUpdate = this.saveInfo(info);
                        info = null;
                        if (isDisplay) {
                            this.watchdripData.setData(dataInfo);
                            this.watchdripData.updateTimeDiff();
                            dataInfo = null;

                            this.updateWidgets();
                        }
                    } catch (e) {
                        debug.log("error:" + e);
                    }
                })
                .catch((error) => {
                    debug.log("fetch error:" + error);
                })
                .finally(() => {
                    this.updatingData = false;
                    if (isDisplay && !this.lastUpdateSucessful) {
                        this.showMessage(getText("status_start_watchdrip"));
                    }
                    if (!isDisplay) {
                        this.stopLoader();
                        this.handleGoBack();
                    }
                });
        } catch (e) {
            debug.log("error in fetchInfo:" + e);
        }
    }

    startLoader() {
        this.progressWidget.setProperty(hmUI.prop.VISIBLE, true);
        this.progressWidget.setProperty(hmUI.prop.MORE, {angle: this.progressAngle});
        this.progressTimer = this.globalNS.setInterval(() => {
            this.updateLoader();
        }, PROGRESS_UPDATE_INTERVAL_MS);
    }

    updateLoader() {
        this.progressAngle = this.progressAngle + PROGRESS_ANGLE_INC;
        if (this.progressAngle >= 360) this.progressAngle = 0;
        this.progressWidget.setProperty(hmUI.prop.MORE, {angle: this.progressAngle});
    }

    stopLoader() {
        if (this.progressTimer !== null) {
            this.globalNS.clearInterval(this.progressTimer);
            this.progressTimer = null;
        }
        this.progressWidget.setProperty(hmUI.prop.VISIBLE, false);
    }

    updateWidgets() {
        debug.log('updateWidgets');
        this.setMessageVisibility(false);
        this.setBgElementsVisibility(true);
        this.updateValuesWidget()
        this.updateTimesWidget()
    }

    updateValuesWidget() {
        let bgValColor = Colors.white;
        let bgObj = this.watchdripData.getBg();
        if (bgObj.isHigh) {
            bgValColor = Colors.bgHigh;
        } else if (bgObj.isLow) {
            bgValColor = Colors.bgLow;
        }

        this.bgValTextWidget.setProperty(hmUI.prop.MORE, {
            text: bgObj.getBGVal(),
            color: bgValColor,
        });

        this.bgDeltaTextWidget.setProperty(hmUI.prop.MORE, {
            text: bgObj.delta + " " + this.watchdripData.getStatus().getUnitText()
        });

        //debug.log(bgObj.getArrowResource());
        this.bgTrendImageWidget.setProperty(hmUI.prop.SRC, bgObj.getArrowResource());
        this.bgStaleLine.setProperty(hmUI.prop.VISIBLE, this.watchdripData.isBgStale());
    }

    updateTimesWidget() {
        let bgObj = this.watchdripData.getBg();
        this.bgValTimeTextWidget.setProperty(hmUI.prop.MORE, {
            text: this.watchdripData.getTimeAgo(bgObj.time),
        });
    }

    showMessage(text) {
        this.setBgElementsVisibility(false);
        //use for autowrap
        //
        // let lay = hmUI.getTextLayout(text, {
        //     text_size: MESSAGE_TEXT_SIZE,
        //     text_width: MESSAGE_TEXT_WIDTH,
        //     wrapped: 1
        // });
        // debug.log(lay);
        this.messageTextWidget.setProperty(hmUI.prop.MORE, {text: text});
        this.setMessageVisibility(true);
    }

    setBgElementsVisibility(visibility) {
        this.bgValTextWidget.setProperty(hmUI.prop.VISIBLE, visibility);
        this.bgValTimeTextWidget.setProperty(hmUI.prop.VISIBLE, visibility);
        this.bgTrendImageWidget.setProperty(hmUI.prop.VISIBLE, visibility);
        this.bgStaleLine.setProperty(hmUI.prop.VISIBLE, visibility);
        this.bgDeltaTextWidget.setProperty(hmUI.prop.VISIBLE, visibility);
    }

    setMessageVisibility(visibility) {
        this.messageTextWidget.setProperty(hmUI.prop.VISIBLE, visibility);
    }

    readInfo() {
        let info = "";
        if (USE_FILE_INFO_STORAGE) {
            info = fs.readTextFile(WF_INFO_FILE);
        } else {
            info = hmFS.SysProGetChars(WF_INFO);
        }
        if (info) {
            let data = {};
            try {
                data = str2json(info);
                info = null;
                debug.log("data was read");
                this.watchdripData.setData(data);
                this.watchdripData.timeDiff = 0;
            } catch (e) {

            }
            data = null;
            return true
        }
        return false;
    }

    readLastUpdate() {
        let lastInfoUpdate = hmFS.SysProGetInt64(WF_INFO_LAST_UPDATE);
        this.lastUpdateAttempt = hmFS.SysProGetInt64(WF_INFO_LAST_UPDATE_ATTEMPT);
        this.lastUpdateSucessful = hmFS.SysProGetBool(WF_INFO_LAST_UPDATE_SUCCESS);
        return lastInfoUpdate;
    }

    resetLastUpdate() {
        this.lastUpdateAttempt = this.timeSensor.utc;
        hmFS.SysProSetInt64(WF_INFO_LAST_UPDATE_ATTEMPT, this.lastUpdateAttempt);
        this.lastUpdateSucessful = false;
        hmFS.SysProSetBool(WF_INFO_LAST_UPDATE_SUCCESS, this.lastUpdateSucessful);
    }

    createWatchdripDir() {
        if (USE_FILE_INFO_STORAGE) {
            if (!fs.statSync(WF_INFO_DIR)) {
                fs.mkdirSync(WF_INFO_DIR);
            }
            // const [fileNameArr] = hmFS.readdir("/storage");
            // debug.log(fileNameArr);
        }
    }

    saveInfo(info) {
        if (USE_FILE_INFO_STORAGE) {
            fs.writeTextFile(WF_INFO_FILE, info);
        } else {
            hmFS.SysProSetChars(WF_INFO, info);
        }
        this.lastUpdateSucessful = true;
        let time = this.timeSensor.utc;
        hmFS.SysProSetInt64(WF_INFO_LAST_UPDATE, time);
        hmFS.SysProSetBool(WF_INFO_LAST_UPDATE_SUCCESS, this.lastUpdateSucessful);
        return time;
    }

    saveAlarmId(alarm_id) {
        hmFS.SysProSetInt64(WF_SYSTEM_ALARM_ID, alarm_id);
    }

    readAlarmId() {
        return hmFS.SysProGetInt64(WF_SYSTEM_ALARM_ID);
    }

    readAlarmConfig() {
        var configStr = hmFS.SysProGetChars(WATCHDRIP_ALARM_CONFIG);
        if (!configStr) {
            this.watchdripAlarmConfig = WATCHDRIP_ALARM_CONFIG_DEFAULTS;
            this.saveAlarmConfig();
        } else {
            try {
                this.watchdripAlarmConfig = str2json(configStr);
            } catch (e) {

            }
        }
    }

    saveAlarmConfig() {
        hmFS.SysProSetChars(WATCHDRIP_ALARM_CONFIG, json2str(this.watchdripAlarmConfig));
    }

    disableCurrentAlarm() {
        var alarm_id = this.readAlarmId(); //read saved alarm to disable
        if (alarm_id && alarm_id !== -1) {
            debug.log("stop old app alarm");
            hmApp.alarmCancel(alarm_id);
            this.saveAlarmId('-1');
        }
    }

    prepareNextAlarm() {
        this.disableCurrentAlarm();
        if (this.watchdripConfig.disableUpdates || !this.watchdripConfig.useAppFetch) {
            if (this.system_alarm_id !== null) {
                hmApp.alarmCancel(this.system_alarm_id);
            }
            return;
        }
        debug.log("Next alarm in " + this.watchdripAlarmConfig.fetchInterval + "s");
        if (this.system_alarm_id == null) {
            this.system_alarm_id = hmApp.alarmNew({
                appid: appId,
                url: "page/index",
                param: PagesType.UPDATE_LOCAL,
                delay: this.watchdripAlarmConfig.fetchInterval,
            });
            this.saveAlarmId(this.system_alarm_id);
        }
    }

    handleGoBack() {
        switch (this.goBackType) {
            case GoBackType.NONE:
                break;
            case GoBackType.GO_BACK:
                hmApp.goBack();
                break;
            case GoBackType.HIDE:
                this.hide_page();
                break;
            case GoBackType.HIDE_PAGE:
                gotoSubpage(PagesType.HIDE);
                break;
        }
    }


    fetchImg() {
        const fileName = SERVER_IMAGE_URL;
        messageBuilder
            .request({
                method: Commands.getImg,
                params: fileName,
            })
            .then((data) => {
                logger.log("receive data");
                const {result = {}} = data;
                debug.log(`Received file size: ${result.length} bytes`);
                let filePath = fs.fullPath(fileName);
                debug.log(filePath);
                let file = fs.getSelfPath() + "/assets";
                const [fileNameArr, err] = hmFS.readdir(file);
                debug.log(file);
                debug.log(fileNameArr);

                const hex = Buffer.from(result, "base64");

                fs.writeRawFileSync(filePath, hex);
                var res = fs.statSync(filePath);
                debug.log(res);
                // Image view
                let view = hmUI.createWidget(hmUI.widget.IMG, {
                    x: px(0),
                    y: px(0),
                    src: fileName,
                });
            });
    }

    vibrateNow() {
        this.vibrate.stop();
        this.vibrate.scene = 24;
        this.vibrate.start();
    }

    onDestroy() {
        //this.disableCurrentAlarm(); //do not stop alarm on destroy
        this.stopDataUpdates();
        this.vibrate.stop();
        hmSetting.setBrightScreenCancel();
    }
}

Page({
    onInit(p) {
        try {
            debug = new DebugText();
            debug.setLines(20);
            console.log("page onInit");
            let data = {page: PagesType.MAIN};
            try {
                if (!(!p || p === 'undefined')) {
                    data = JSON.parse(p);
                }
            } catch (e) {
                data = {page: p}
            }

            watchdrip = new Watchdrip()
            watchdrip.start(data);
        } catch (e) {
            console.log('Watchdrip app LifeCycle Error ' + e)
            e && e.stack && e.stack.split(/\n/).forEach((i) => console.log('error stack:' + i))
            hmApp.exit()
        }
    },
    build() {
        logger.debug("page build invoked");
    },
    onDestroy() {
        try{
            logger.debug("page onDestroy invoked");
            watchdrip.onDestroy();
        } catch (e) {
            console.log('Watchdrip app LifeCycle Error onDestroy ' + e)
            e && e.stack && e.stack.split(/\n/).forEach((i) => console.log('error stack:' + i))
            hmApp.exit()
        }
    },
});
