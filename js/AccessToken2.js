// Browser-compatible AccessToken2.js
// Uses Web Crypto API and pako.js instead of Node.js modules

const VERSION_LENGTH = 3
const APP_ID_LENGTH = 32

const getVersion = () => {
    return '007'
}

// Helper function to convert Uint8Array to Buffer-like object
function uint8ArrayToBufferLike(arr) {
    return {
        readUInt16LE: (offset) => {
            return arr[offset] | (arr[offset + 1] << 8)
        },
        readUInt32LE: (offset) => {
            return arr[offset] | (arr[offset + 1] << 8) | (arr[offset + 2] << 16) | (arr[offset + 3] << 24)
        },
        readInt16LE: (offset) => {
            const val = arr[offset] | (arr[offset + 1] << 8)
            return val > 32767 ? val - 65536 : val
        },
        copy: (target, targetStart, sourceStart, sourceEnd) => {
            const len = sourceEnd - sourceStart
            for (let i = 0; i < len; i++) {
                target[targetStart + i] = arr[sourceStart + i]
            }
            return len
        },
        length: arr.length
    }
}

// Web Crypto API HMAC function
async function encodeHMac(key, message) {
    const keyData = typeof key === 'string' ? new TextEncoder().encode(key) : key
    const messageData = typeof message === 'string' ? new TextEncoder().encode(message) : message
    
    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    )
    
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData)
    return new Uint8Array(signature)
}

// Synchronous wrapper for encodeHMac (using async/await pattern)
function encodeHMacSync(key, message) {
    // This will be called with await in build() method
    return encodeHMac(key, message)
}

class Service {
    constructor(service_type) {
        this.__type = service_type
        this.__privileges = {}
    }

    __pack_type() {
        let buf = new ByteBuf()
        buf.putUint16(this.__type)
        return buf.pack()
    }

    __pack_privileges() {
        let buf = new ByteBuf()
        buf.putTreeMapUInt32(this.__privileges)
        return buf.pack()
    }

    service_type() {
        return this.__type
    }

    add_privilege(privilege, expire) {
        this.__privileges[privilege] = expire
    }

    pack() {
        return concatUint8Arrays([this.__pack_type(), this.__pack_privileges()])
    }

    unpack(buffer) {
        let bufReader = new ReadByteBuf(buffer)
        this.__privileges = bufReader.getTreeMapUInt32()
        return bufReader
    }
}

const kRtcServiceType = 1

class ServiceRtc extends Service {
    constructor(channel_name, uid) {
        super(kRtcServiceType)
        this.__channel_name = channel_name
        this.__uid = uid === 0 ? '' : `${uid}`
    }

    pack() {
        let buffer = new ByteBuf()
        buffer.putString(this.__channel_name).putString(this.__uid)
        return concatUint8Arrays([super.pack(), buffer.pack()])
    }

    unpack(buffer) {
        let bufReader = super.unpack(buffer)
        this.__channel_name = bufReader.getString()
        this.__uid = bufReader.getString()
        return bufReader
    }
}

ServiceRtc.kPrivilegeJoinChannel = 1
ServiceRtc.kPrivilegePublishAudioStream = 2
ServiceRtc.kPrivilegePublishVideoStream = 3
ServiceRtc.kPrivilegePublishDataStream = 4

const kRtmServiceType = 2

class ServiceRtm extends Service {
    constructor(user_id) {
        super(kRtmServiceType)
        this.__user_id = user_id || ''
    }

    pack() {
        let buffer = new ByteBuf()
        buffer.putString(this.__user_id)
        return concatUint8Arrays([super.pack(), buffer.pack()])
    }

    unpack(buffer) {
        let bufReader = super.unpack(buffer)
        this.__user_id = bufReader.getString()
        return bufReader
    }
}

ServiceRtm.kPrivilegeLogin = 1

const kFpaServiceType = 4

class ServiceFpa extends Service {
    constructor() {
        super(kFpaServiceType)
    }

    pack() {
        return super.pack()
    }

    unpack(buffer) {
        let bufReader = super.unpack(buffer)
        return bufReader
    }
}

ServiceFpa.kPrivilegeLogin = 1

const kChatServiceType = 5

class ServiceChat extends Service {
    constructor(user_id) {
        super(kChatServiceType)
        this.__user_id = user_id || ''
    }

    pack() {
        let buffer = new ByteBuf()
        buffer.putString(this.__user_id)
        return concatUint8Arrays([super.pack(), buffer.pack()])
    }

    unpack(buffer) {
        let bufReader = super.unpack(buffer)
        this.__user_id = bufReader.getString()
        return bufReader
    }
}

ServiceChat.kPrivilegeUser = 1
ServiceChat.kPrivilegeApp = 2

const kApaasServiceType = 7

class ServiceApaas extends Service {
    constructor(roomUuid, userUuid, role) {
        super(kApaasServiceType)
        this.__room_uuid = roomUuid || ''
        this.__user_uuid = userUuid || ''
        this.__role = role || -1
    }

    pack() {
        let buffer = new ByteBuf()
        buffer.putString(this.__room_uuid)
        buffer.putString(this.__user_uuid)
        buffer.putInt16(this.__role)
        return concatUint8Arrays([super.pack(), buffer.pack()])
    }

    unpack(buffer) {
        let bufReader = super.unpack(buffer)
        this.__room_uuid = bufReader.getString()
        this.__user_uuid = bufReader.getString()
        this.__role = bufReader.getInt16()
        return bufReader
    }
}

ServiceApaas.PRIVILEGE_ROOM_USER = 1
ServiceApaas.PRIVILEGE_USER = 2
ServiceApaas.PRIVILEGE_APP = 3

class AccessToken2 {
    constructor(appId, appCertificate, issueTs, expire) {
        this.appId = appId
        this.appCertificate = appCertificate
        this.issueTs = issueTs || Math.floor(Date.now() / 1000)
        this.expire = expire
        // salt ranges in (1, 99999999)
        this.salt = Math.floor(Math.random() * 99999999) + 1
        this.services = {}
    }

    async __signing() {
        let signing = await encodeHMac(new ByteBuf().putUint32(this.issueTs).pack(), this.appCertificate)
        signing = await encodeHMac(new ByteBuf().putUint32(this.salt).pack(), signing)
        return signing
    }

    __build_check() {
        let is_uuid = data => {
            if (data.length !== APP_ID_LENGTH) {
                return false
            }
            try {
                // Check if it's a valid hex string
                const buf = hexStringToUint8Array(data)
                return buf.length === 16
            } catch (e) {
                return false
            }
        }

        const { appId, appCertificate, services } = this
        if (!is_uuid(appId) || !is_uuid(appCertificate)) {
            return false
        }

        if (Object.keys(services).length === 0) {
            return false
        }
        return true
    }

    add_service(service) {
        this.services[service.service_type()] = service
    }

    async build() {
        if (!this.__build_check()) {
            return ''
        }

        let signing = await this.__signing()
        let signing_info = new ByteBuf()
            .putString(this.appId)
            .putUint32(this.issueTs)
            .putUint32(this.expire)
            .putUint32(this.salt)
            .putUint16(Object.keys(this.services).length)
            .pack()
        Object.values(this.services).forEach(service => {
            signing_info = concatUint8Arrays([signing_info, service.pack()])
        })

        let signature = await encodeHMac(signing, signing_info)
        let signatureBuf = new ByteBuf().putBytes(signature).pack()
        let content = concatUint8Arrays([signatureBuf, signing_info])
        let compressed = pako.deflate(content)
        return `${getVersion()}${uint8ArrayToBase64(compressed)}`
    }

    from_string(origin_token) {
        let origin_version = origin_token.substring(0, VERSION_LENGTH)
        if (origin_version !== getVersion()) {
            return false
        }

        let origin_content = origin_token.substring(VERSION_LENGTH, origin_token.length)
        let buffer = pako.inflate(base64ToUint8Array(origin_content))
        let bufferReader = new ReadByteBuf(uint8ArrayToBufferLike(buffer))

        let signature = bufferReader.getBytes()
        this.appId = bufferReader.getString()
        this.issueTs = bufferReader.getUint32()
        this.expire = bufferReader.getUint32()
        this.salt = bufferReader.getUint32()
        let service_count = bufferReader.getUint16()

        let remainBuf = bufferReader.pack()
        for (let i = 0; i < service_count; i++) {
            let bufferReaderService = new ReadByteBuf(uint8ArrayToBufferLike(remainBuf))
            let service_type = bufferReaderService.getUint16()
            let service = new AccessToken2.kServices[service_type]()
            remainBuf = service.unpack(bufferReaderService.pack()).pack()
            this.services[service_type] = service
        }
    }
}

// Helper functions
function hexStringToUint8Array(hex) {
    const bytes = new Uint8Array(hex.length / 2)
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substr(i, 2), 16)
    }
    return bytes
}

function uint8ArrayToBase64(arr) {
    const binary = String.fromCharCode.apply(null, arr)
    return btoa(binary)
}

function base64ToUint8Array(base64) {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
    }
    return bytes
}

function concatUint8Arrays(arrays) {
    const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0)
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const arr of arrays) {
        result.set(arr, offset)
        offset += arr.length
    }
    return result
}

var ByteBuf = function () {
    var that = {
        buffer: new Uint8Array(1024),
        position: 0
    }

    that.buffer.fill(0)

    that.pack = function () {
        var out = new Uint8Array(that.position)
        for (let i = 0; i < that.position; i++) {
            out[i] = that.buffer[i]
        }
        return out
    }

    that.putUint16 = function (v) {
        that.buffer[that.position] = v & 0xff
        that.buffer[that.position + 1] = (v >> 8) & 0xff
        that.position += 2
        return that
    }

    that.putUint32 = function (v) {
        that.buffer[that.position] = v & 0xff
        that.buffer[that.position + 1] = (v >> 8) & 0xff
        that.buffer[that.position + 2] = (v >> 16) & 0xff
        that.buffer[that.position + 3] = (v >> 24) & 0xff
        that.position += 4
        return that
    }
    
    that.putInt32 = function (v) {
        if (v < 0) {
            v = 0xffffffff + v + 1
        }
        that.putUint32(v)
        return that
    }

    that.putInt16 = function (v) {
        if (v < 0) {
            v = 0xffff + v + 1
        }
        that.putUint16(v)
        return that
    }

    that.putBytes = function (bytes) {
        that.putUint16(bytes.length)
        for (let i = 0; i < bytes.length; i++) {
            that.buffer[that.position + i] = bytes[i]
        }
        that.position += bytes.length
        return that
    }

    that.putString = function (str) {
        if (str instanceof Uint8Array) {
            return that.putBytes(str)
        }
        const strBytes = new TextEncoder().encode(str)
        return that.putBytes(strBytes)
    }

    that.putTreeMap = function (map) {
        if (!map) {
            that.putUint16(0)
            return that
        }

        that.putUint16(Object.keys(map).length)
        for (var key in map) {
            that.putUint16(key)
            that.putString(map[key])
        }

        return that
    }

    that.putTreeMapUInt32 = function (map) {
        if (!map) {
            that.putUint16(0)
            return that
        }

        that.putUint16(Object.keys(map).length)
        for (var key in map) {
            that.putUint16(key)
            that.putUint32(map[key])
        }

        return that
    }

    return that
}

var ReadByteBuf = function (bufferLike) {
    var that = {
        buffer: bufferLike,
        position: 0
    }

    that.getUint16 = function () {
        var ret = that.buffer.readUInt16LE(that.position)
        that.position += 2
        return ret
    }

    that.getUint32 = function () {
        var ret = that.buffer.readUInt32LE(that.position)
        that.position += 4
        return ret
    }

    that.getInt16 = function () {
        var ret = that.buffer.readInt16LE(that.position)
        that.position += 2
        return ret
    }

    that.getString = function () {
        var len = that.getUint16()
        var strBytes = new Uint8Array(len)
        that.buffer.copy(strBytes, 0, that.position, that.position + len)
        that.position += len
        return new TextDecoder().decode(strBytes)
    }
    
    that.getBytes = function () {
        var len = that.getUint16()
        var bytes = new Uint8Array(len)
        that.buffer.copy(bytes, 0, that.position, that.position + len)
        that.position += len
        return bytes
    }

    that.getTreeMapUInt32 = function () {
        var map = {}
        var len = that.getUint16()
        for (var i = 0; i < len; i++) {
            var key = that.getUint16()
            var value = that.getUint32()
            map[key] = value
        }
        return map
    }

    that.pack = function () {
        let length = that.buffer.length
        var out = new Uint8Array(length - that.position)
        that.buffer.copy(out, 0, that.position, length)
        return out
    }

    return that
}

AccessToken2.kServices = {}
AccessToken2.kServices[kApaasServiceType] = ServiceApaas
AccessToken2.kServices[kChatServiceType] = ServiceChat
AccessToken2.kServices[kFpaServiceType] = ServiceFpa
AccessToken2.kServices[kRtcServiceType] = ServiceRtc
AccessToken2.kServices[kRtmServiceType] = ServiceRtm

// Export for browser
window.AccessToken2 = AccessToken2
window.ServiceRtc = ServiceRtc
window.ServiceRtm = ServiceRtm
window.ServiceChat = ServiceChat
window.ServiceFpa = ServiceFpa
window.ServiceApaas = ServiceApaas
