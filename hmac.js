const { subtle } =  require('node:crypto');

async function hmacUnMsg(challengeString, msg) {
    const enc = new TextEncoder();
    let jsonArr = JSON.parse(msg.signature);
    let sigArr = new Uint8Array(64);
    for(let i in jsonArr) {
        sigArr[i] = jsonArr[i];
    }
    let key = await subtle.importKey(
        "raw",
        enc.encode(challengeString),
        {name: "HMAC", hash: "SHA-512"},
        false,
        ["sign", "verify"]
    );
    let verified = await subtle.verify(
        "HMAC",
        key,
        sigArr.buffer,
        enc.encode(msg.message),
    );

    return verified;
}

async function hmacMsg(challengeString, msg) {
	const enc = new TextEncoder();
	const dec = new TextDecoder();
	let timestamp = Date.now();
	msg.timestamp = timestamp;
	let msgStr = encodeURIComponent(JSON.stringify(msg));
	let key = await subtle.importKey(
		"raw",
		enc.encode(challengeString),
		{name: "HMAC", hash: "SHA-512"},
		false,
		["sign", "verify"]
	);
	let sig = await subtle.sign(
		"HMAC",
		key,
		enc.encode(msgStr)
	);
	return { signature: JSON.stringify(new Uint8Array(sig)), message: msgStr, id: msg.id, timestamp: timestamp};
}

module.exports = {hmacMsg, hmacUnMsg};
