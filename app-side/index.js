import {MessageBuilder} from "../shared/message";
import {Commands, SERVER_INFO_URL, SERVER_URL,} from "../utils/config/constants";

// const logger = DeviceRuntimeCore.HmLogger.getLogger("watchdrip_side");
const messageBuilder = new MessageBuilder();

const fetchInfo = async (ctx, url, hours) => {
    try{
        let resp = {};

        await fetch({
            url: url,
            method: "GET",
        }).then((response) => {
            if (!response.body)
                throw Error('No Data')

            return response.body
        })
        .then((data) => {
            try {
                console.log("log", data);
                // const parsed = JSON.stringify(data);
                // console.log("log", parsed);
                let HOURS = (typeof hours === 'undefined') ? 2 : hours
                let resBody = typeof data === 'string' ?  JSON.parse(data) : data
                if (resBody['graph'] !== undefined && HOURS < 4){
                    if (HOURS === 0){
                        delete resBody['graph']
                    } else {
                        const time_graph = 60 * 60 * 1000 * HOURS / resBody.graph.fuzzer
                        const end = resBody.graph.end
                        const start = resBody.graph.start
                        const new_start = end - time_graph - 32
                        resBody.graph.lines.forEach((line, m) => {
                            if (!line.name.startsWith("line")){
                                let new_points = line.points.filter(function (point) {
                                    return point[0] >= new_start
                                });
                                if (new_points.length > 0){
                                    resBody.graph.lines[m].points = new_points
                                } else {
                                    delete resBody.graph.lines[m]
                                }
                            } else {
                                line.points.forEach((point, n) => {
                                    if (point[0] === start){
                                        resBody.graph.lines[m].points[n][0] = new_start
                                    }
                                })
                            }
                        })
                        resBody.graph.start = new_start
                    }
                }
                resp = JSON.stringify(resBody);
            } catch (error) {
                throw Error(error.message)
            }
        })
        .catch(function (error) {
            resp = {error: true, message: error.message};
        })
        .finally(() => {
                const jsonResp = {data: {result: resp}};
                if (ctx !== false) {
                    ctx.response(jsonResp);
                } else {
                    return jsonResp;
                }
            }
        )
    } catch (error) {
        console.log('error in fetch on app-side: ' + error)
        if (ctx !== false) {
            ctx.response({
                data: { result: {error: true, message: 'error fetch on app-side'} },
            })
        } else {
            return {data: { result: {error: true, message: 'error fetch on app-side'} }}
        }
    }
};

const sendToWatch = async () => {
    console.log("log", "sendToWatch");
    const result = await fetchInfo();
    messageBuilder.call(result);
};

const fetchRaw = async (ctx, url) => {
    try {
        const {body: data} = await fetch({
            url: url,
            method: "GET",
        });
        console.log("log", data);
        ctx.response({
            data: {result: data},
        });
    } catch (error) {
        ctx.response({
            data: {result: "ERROR"},
        });
    }
};

AppSideService({
    onInit() {
        // timer1 = setInterval(sendToWatch, 1000);

        messageBuilder.listen(() => {
        });
        messageBuilder.on("request", (ctx) => {
            const jsonRpc = messageBuilder.buf2Json(ctx.request.payload);
            const {params = {}} = jsonRpc;
            let url = SERVER_URL;
            switch (jsonRpc.method) {
                case Commands.getInfo:
                    return fetchInfo(ctx, url + SERVER_INFO_URL + "?" + params, jsonRpc.hours);
                case Commands.getImg:
                    return fetchRaw(ctx, url + "get_img.php?" + params);
                case Commands.putTreatment:
                    return fetchRaw(ctx, url + SERVER_PUT_TREATMENTS_URL + "?" + params);
                default:
                    break;
            }
        });
    },

    onRun() {
    },
    onDestroy() {
    },
});
