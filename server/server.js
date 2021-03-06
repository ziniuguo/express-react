import http from "http";
import express from "express";
import axios from "axios";
import {MongoClient} from "mongodb";
import {WebSocketServer} from "ws";
import fs from "fs";
import auth from "./auth.js";


const app = express();
const destination = JSON.parse(fs.readFileSync('destinations.json'));


app.use(express.json());
app.use(express.urlencoded({extended: false}));


// app.get('/login', auth);
// app.get('/manage', auth);
// app.post('/register', auth);
// app.post('/authenticate', auth)
app.use(auth) // auth is router

app.post('/booking', function (req, res) {
    let newBooking = req.body;
    console.log('received!');

    const url = "mongodb://localhost:27017/";
    const client = new MongoClient(url);

    async function addBooking(booking){
        try{
            const bDB = client.db('hotelBookingSystem');
            const bookingsC = bDB.collection('bookings');

            await bookingsC.insertOne(booking);
            console.log("New booking added to bookings collection!");
        }
        finally{
            await client.close();
        }

    }
    addBooking(newBooking).then(() => res.send(newBooking));
});


app.get("/hotel/:hotelName", async function (req, res) {
    let tryURL = 'https://hotelapi.loyalty.dev/api/hotels/' + req.url.split('/').pop();
    let apiResult;
    let result = [];
    console.log(tryURL)
    const getOptions = {
        url: tryURL,
        method: 'GET',
        headers: {'Content-Type': 'application/json'},
    }

    await axios(getOptions)
        .then(response => {
            apiResult = response.data;
        })
        .catch((error) => {
            console.log(error);
        });
    result.push(apiResult["name"])
    result.push(apiResult["latitude"])
    result.push(apiResult["longitude"])
    result.push(apiResult["address"])
    result.push(apiResult["rating"])
    result.push(apiResult["description"])
    result.push(apiResult["cloudflare_image_url"] + "/" + apiResult["id"] + "/i")
    result.push(apiResult["number_of_images"])
    console.log(result)
    res.json(result)
})

app.get("/search", async (req, res) => {
    if (req.query.hasOwnProperty('q') &&
        req.query.hasOwnProperty('page') &&
        req.query.hasOwnProperty("loc") &&
        req.query.hasOwnProperty('locID') &&
        req.query.hasOwnProperty('checkin') &&
        req.query.hasOwnProperty('checkout') &&
        req.query.hasOwnProperty('guests')) {
        let pageNo;
        let itemPerPage = 5;
        let result;
        let apiResult;
        let searchComplete = false;
        let searchTime = 0;

        // ?????????api?????????????????????filter?????????hotel???????????????????????????
        const getOptions = {
            url: 'https://hotelapi.loyalty.dev/api/hotels/prices?' + new URLSearchParams({
                destination_id: req.query.locID,
                checkin: req.query.checkin,
                checkout: req.query.checkout,
                lang: "en_US",
                currency: "SGD",
                country_code: "SG",
                guests: req.query.guests,
                partner_id: 1,
            }),
            method: 'GET',
            headers: {'Content-Type': 'application/json'},
        }
        while (!searchComplete && searchTime <= 3) {
            console.log("=== searching ===")
            console.log("searchTime: " + searchTime)
            await axios(getOptions)
                .then(response => {
                    apiResult = response.data;
                })
                .catch(() => {
                    console.log("error @ getting hotel ID by filters");
                });
            if (typeof apiResult === 'undefined' || apiResult["hotels"].length === 0) {
                console.log("empty hotel list...")
                searchTime += 1;
            } else {
                console.log("got hotel list! length: " + apiResult["hotels"].length)
                searchComplete = true;
                // searchTime += 1;
            }
        }
        if (searchComplete) {
            result = apiResult["hotels"];
        } else {
            result = [];
        }

        pageNo = Math.ceil(Object.keys(result).length / itemPerPage);
        if (pageNo === 0) {
            console.log("no match")
            res.json(["no match", 1]);
        } else {
            const reqPage = parseInt(req.query.page);
            if (reqPage <= pageNo && reqPage >= 1) {
                let currPageRawData = Object.entries(result)
                    .slice((reqPage - 1) * itemPerPage, itemPerPage * reqPage)
                    .map(entry => entry[1]); // ?????????????????? ??????????????????????????? ?????????????????????json object, idk why
                // ???????????????id?????????????????????????????????
                currPageRawData = currPageRawData.map(e => [e["id"], e["lowest_price"] + " - " + e["price"]])
                let resResult = []

                //????????????????????? ?????????
                // ???????????????5???item(????????????)
                // ????????????????????????????????????try 4???(??????try????????????????????????????????????????????????0)
                // ??????5*4=20???
                // ???????????????????????????????????????item??????(5) ????????????error
                // ???????????? ????????????????????????item 4????????????????????????error???
                // ?????????????????????????????????????????????
                // ??????????????????????????????
                for (let i = 0;
                     i < currPageRawData.length;
                     // not itemPerPage! sometimes one page not 5 items!
                     i++) {
                    let currID = currPageRawData[i][0];
                    let currResult = [];
                    let opt = {
                        url: "https://hotelapi.loyalty.dev/api/hotels/" + currID,
                        method: 'GET',
                        headers: {'Content-Type': 'application/json'},
                    }
                    let loadComplete = false;
                    let loadTime = 0;
                    // ??????????????????????????????try 4???
                    while (!loadComplete && loadTime <= 3) {
                        console.log("=== loading ===")
                        console.log("loadTime: " + loadTime)
                        await axios(opt)
                            .then(response => {
                                currResult.push(currID);
                                currResult.push(response.data["name"])
                                currResult.push([currPageRawData[i][1]]) // price
                                currResult.push(response.data["address"])
                                currResult.push(response.data["cloudflare_image_url"] + "/" + response.data["id"] + "/i" + response.data["default_image_index"] + ".jpg")
                                currResult.push(response.data["rating"])
                                resResult.push(currResult)
                            })
                            .catch(() => {
                                console.log("error @ getting hotel detail by ID");
                            });
                        // (??????try????????????????????????????????????????????????0)
                        if (currResult.length === 0) {
                            console.log("wrong")
                            loadTime += 1;
                        } else {
                            console.log("get detail by id success! length: " + resResult.length)
                            loadComplete = true;
                        }
                    }
                }
                if (resResult.length ===
                    currPageRawData.length
                    // similarly, not itemPerPage!
                ) {
                    resResult.push(pageNo);
                    res.json(resResult);
                } else {
                    console.log("error_loading_detail_by_ID");
                    res.json(["error_loading_detail_by_ID", 1]);
                }


            } else {
                res.json(["page_exceeded", 1]);
            }
        }
    } else {
        res.json(["undefined_query_params", 1]);
    }
})

const server = http.createServer(app);
const wss = new WebSocketServer({server})


wss.on('connection', ws => {

    ws.on('message', message => {
        console.log(`Received message => ${message}`)
        let searchResult = [];
        for (let i = 0; i < destination.length; i++) {
            if ((typeof destination[i]["term"] === 'undefined' ? "" : destination[i]["term"]).toUpperCase().includes(message.toString().toUpperCase())) {
                if (!searchResult.some(el => el.label === destination[i]["term"])) {
                    // searchResult.push(destination[i]["term"])
                    searchResult.push({"label": destination[i]["term"], "id": destination[i]["uid"]})
                }
            }
        }
        ws.send(JSON.stringify(searchResult));
    })
})


server.listen(5000, () => {
    console.log(`Listening at http://localhost:5000`)
})
// app.listen(5000, () => {
//     console.log("Server started on port 5000");
// });