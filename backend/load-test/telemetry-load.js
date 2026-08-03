import autocannon from 'autocannon'

const targetUrl = process.env.TARGET_URL || 'http://localhost:3001/telemetry'

console.log('====================================================')
console.log('⚡ TELEMETRY INGESTION ENDPOINT LOAD TEST ⚡')
console.log(`Target: ${targetUrl}`)
console.log('====================================================')

let globalSeq = 1

function getRandomPayload() {
  const deviceNum = Math.floor(Math.random() * 2000) + 1
  const deviceId = `DEV-${String(deviceNum).padStart(5, '0')}`
  const poleId = `POLE-${String(deviceNum).padStart(5, '0')}`
  const seq = ++globalSeq

  return JSON.stringify({
    device_id: deviceId,
    pole_id: poleId,
    event: 'heartbeat',
    energized: true,
    ts: new Date().toISOString(),
    seq: seq,
    battery_mv: 3700,
    rssi: -65,
    fw: 'v1.2.0',
  })
}

async function runSustainedTest() {
  console.log('\n📊 TEST 1: Sustained Load Test (Target: >= 500 msg/s for 10s)')
  console.log('----------------------------------------------------')

  const instance = autocannon({
    url: targetUrl,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    duration: 10,
    connections: 50,
    pipelining: 1,
    setupClient: (client) => {
      client.on('request', () => {
        client.setBody(getRandomPayload())
      })
    },
  })

  autocannon.track(instance, { renderProgressBar: false })

  const result = await instance

  console.log('\n--- Sustained Test Results ---')
  console.log(`Duration         : ${result.duration} seconds`)
  console.log(`Total Requests   : ${result.requests.total.toLocaleString()}`)
  console.log(`Req/Sec Average  : ${result.requests.average.toFixed(2)} msg/s`)
  console.log(`Req/Sec Max      : ${result.requests.max.toFixed(2)} msg/s`)
  console.log(`2xx Responses    : ${result['2xx'].toLocaleString()}`)
  console.log(`Non-2xx Responses: ${result.non2xx.toLocaleString()}`)
  console.log(
    `Verdict (Target 500 msg/s): ${
      result.requests.average >= 500 ? '✅ PASSED' : '❌ FAILED (Below 500 msg/s)'
    }`
  )

  return result
}

async function runBurstTest() {
  console.log('\n💥 TEST 2: Burst Load Test (Target: 5,000 requests in 10s burst window)')
  console.log('----------------------------------------------------')

  const instance = autocannon({
    url: targetUrl,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    amount: 5000,
    connections: 100,
    pipelining: 2,
    setupClient: (client) => {
      client.on('request', () => {
        client.setBody(getRandomPayload())
      })
    },
  })

  autocannon.track(instance, { renderProgressBar: false })

  const result = await instance

  console.log('\n--- Burst Test Results ---')
  console.log(`Duration         : ${result.duration} seconds`)
  console.log(`Total Requests   : ${result.requests.total.toLocaleString()}`)
  console.log(`Req/Sec Average  : ${result.requests.average.toFixed(2)} msg/s`)
  console.log(`2xx Responses    : ${result['2xx'].toLocaleString()}`)
  console.log(`Non-2xx Responses: ${result.non2xx.toLocaleString()}`)
  console.log(
    `Verdict (Target 5,000 in <= 10s): ${
      result.duration <= 10 && result['2xx'] >= 5000
        ? '✅ PASSED'
        : `❌ FAILED (${result['2xx']} 2xx responses in ${result.duration}s)`
    }`
  )

  return result
}

async function runAllTests() {
  await runSustainedTest()
  await runBurstTest()
  console.log('\n====================================================\n')
}

runAllTests().catch((err) => {
  console.error('Load test failed with error:', err)
  process.exit(1)
})
