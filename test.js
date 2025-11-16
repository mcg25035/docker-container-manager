let DockerModule = require('./dockerModule');

/**
 * @typedef {() => Promise<void>} TestFunction
 */

let TestResult = Object.freeze({
    PASS: 'PASS',
    FAIL: 'FAIL',
    MANUALLY_VERIFY: 'MANUALLY_VERIFY',
});

/**
 * @type {Array<TestFunction>}
 */
let tests = [
    async function testListServices() {
        await DockerModule.listServices();
        return TestResult.MANUALLY_VERIFY;
    },
    async function testIsServiceUp() {
        let serviceName = 'example_service'; // replace with an actual service name for real testing
        let isUp = await DockerModule.isServiceUp(serviceName);
        console.log(`Service ${serviceName} is up: ${isUp}`);
        return TestResult.MANUALLY_VERIFY;
    }
]


async function runTests() {
    for (let i = 0; i < tests.length; i++) {
        let testFunc = tests[i];
        let result;
        console.log(`⏳ Running Test ${i + 1}...`);
        try {
            result = await testFunc();
        } catch (error) {
            result = TestResult.FAIL;
            console.error(`⚠️ Test ${i + 1} threw an error: ${error.message}`);
        }

        if (result === TestResult.FAIL) {
            console.log(`🚩 Test ${i + 1} failed.`);
        }
        else if (result === TestResult.PASS) {
            console.log(`✅ Test ${i + 1} passed.`);
        }
        else if (result === TestResult.MANUALLY_VERIFY) {
            console.log(`🔍 Test ${i + 1} requires manual verification.`);
        }
    }
}

runTests();