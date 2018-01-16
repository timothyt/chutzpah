﻿var module = module || {};
module.exports = module.exports || {};

module.exports.runner = async (inputParams, callback, onInitialized, onPageLoaded, isFrameworkLoaded, onFrameworkLoaded, isTestingDone) => {

    const chutzpahCommon = require('../chutzpahFunctions.js');

    var testFrameworkLoaded = false,
        attemptingToSetupTestFramework = false,
        testFile = null,
        testMode = null,
        timeOut = null,
        startTime = null,
        userAgent = null,
        ignoreResourceLoadingErrors = false,
        finalResult = 0;


    testFile = inputParams.fileUrl;
    testMode = inputParams.testMode || "execution";
    timeOut = parseInt(inputParams.timeOut) || 5001;
    ignoreResourceLoadingErrors = inputParams.ignoreResourceLoadingErrors;
    userAgent = inputParams.userAgent;

    function debugLog(msg) {
        console.log(msg);
    }

    function updateEventTime() {
        startTime = new Date().getTime();
    }

    async function trySetupTestFramework(evaluate) {
        debugLog("trySetupTestFramework");
        if (!testFrameworkLoaded && !attemptingToSetupTestFramework) {
            attemptingToSetupTestFramework = true;
            debugLog("checking isFrameworkLoaded ");
            var loaded = await evaluate(isFrameworkLoaded);
            if (loaded) {
                testFrameworkLoaded = true;
                debugLog("calling onFrameworkLoaded");
                await evaluate(onFrameworkLoaded);
            }

            attemptingToSetupTestFramework = false;
        }

    }

    async function wait(delay) {
        return new Promise(function (resolve, reject) {
            setTimeout(resolve, delay);
        });
    }

    async function waitFor(testIfDone, timeOutMillis) {
        let maxtimeOutMillis = timeOutMillis,
            isDone = false,
            result = -1;

        async function intervalHandler() {
            debugLog("intervalHandler");
            var now = new Date().getTime();
            isDone = testIfDone();
            if (!isDone && ((now - startTime) < maxtimeOutMillis)) {
                return -1; // Not done, try again
            } else {
                if (!isDone) {
                    return 3; // Timeout
                } else {
                    return 0; // Done succesfully
                }
            }
        }

        while (result < 0) {
            debugLog("@@@ wait...: " + result);
            await wait(100);
            result = await intervalHandler();

            if (result >= 0) {
                debugLog("Positive result, fin! " + result);
                return result;
            }
        }
    }

    async function pageOpenHandler(evaluate) {
        debugLog("pageOpenHandler");

        debugLog("Promise in pageOpenHandler");
        // Initialize startTime, this will get updated everytime we recieve
        // content from the test framework
        updateEventTime();
        debugLog("First trySetupTestFramework");
        await trySetupTestFramework(evaluate);


        debugLog("Evaluate onPageLoaded");
        await evaluate(onPageLoaded);
    }

    async function pageInitializedHandler(evaluate) {
        debugLog("pageInitializedHandler");
        await evaluate(onInitialized);
    }

    function getPageInitializationScript() {
        if (testMode === 'discovery') {
            return "window.chutzpah = { testMode: 'discovery', phantom: true };";
        }
        else {
            return "window.chutzpah = { testMode: 'execution', phantom: true };";
        }
    }


    function wrapFunctionForEvaluation(func) {
        let str = '(' + func.toString() + ')()'

        // If the result is an instanceof of Promise, It's resolved in context of nodejs later.
        return `
        {
          let result = ${str};
          if (result instanceof Promise) {
            result;
          }
          else {
            let json = JSON.stringify(result);
            json;
          }
        }
      `.trim()
    }

    const puppeteer = require('puppeteer');

    debugLog("Launch Chrome");
    //const browser = await puppeteer.launch({ headless: false, args: [
    //'--allow-file-access-from-files'
    //],executablePath:"C:/Users/timth/AppData/Local/Microsoft/VisualStudio/15.0_58b2b127/Extensions/qt3zt32i.p4l/node_modules/puppeteer/.local-chromium/win64-515411/chrome-win32/chrome.exe"  });
    const browser = await puppeteer.launch({ headless: false, args: [
    '--allow-file-access-from-files'
    ]});
    const page = await browser.newPage();

    try {

        if (userAgent) {
            page.setUserAgent(userAgent);
        }

        const evaluate = async (func) => { return await page.evaluate(wrapFunctionForEvaluation(func)); };

        var chutzpahFunctions = chutzpahCommon.getCommonFunctions(function (status) { callback(null, status) }, updateEventTime, inputParams.onMessage);

        page.on('requestfinished', (async (request) => {
            //chutzpahFunctions.rawLog("!!_!! Resource Recieved: " + request.url);
            //await trySetupTestFramework(evaluate);
        }));

        page.on('requestfailed', ((request) => {
            let errorText = request.failure().errorText;
            if (!ignoreResourceLoadingError) {
                chutzpahFunctions.onError(errorText);
            }
            chutzpahFunctions.rawLog("!!_!! Resource Error for " + request.url + " with error " + errorText);

        }));

        page.on('console', message => {
            if (message.type === 'error') {
                chutzpahFunctions.onError(message.text, message.text);
            }
            else {
                chutzpahFunctions.captureLogMessage(message.text);
            }
        });

        page.on('error', error => {
            chutzpahFunctions.onError(error.message, error.stack);
        });

        page.on('pageerror', error => {
            chutzpahFunctions.onError(error.message, error.stack);
        });

        await page.evaluateOnNewDocument(getPageInitializationScript());

        debugLog("### Navigate...");
        await page.goto(testFile, { waitUntil: "load" });

        debugLog("### loadEventFired");

        debugLog("### calling pageInitializedHandler");
        await pageInitializedHandler(evaluate);

        debugLog("### calling pageOpenHandler");
        await pageOpenHandler(evaluate);


        debugLog("Calling waitFor...");
        finalResult = await waitFor(chutzpahFunctions.IsTestingFinished, timeout);
        debugLog("Just about done: " + finalResult);

    } catch (err) {
        debugLog("Error: " + err);
        callback(err, null);
        return;
    }


    debugLog("Closing client");
    if (browser) {
        await browser.close();
    }

    debugLog("Closed client");
    debugLog("Calling callback");
    callback(null, 0);
};
