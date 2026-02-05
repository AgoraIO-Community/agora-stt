// Browser-compatible RtcTokenBuilder2.js

const Role = {
    PUBLISHER: 1,
    SUBSCRIBER: 2
}

class RtcTokenBuilder {
    static async buildTokenWithUid(appId, appCertificate, channelName, uid, role, tokenExpire, privilegeExpire = 0) {
        return await this.buildTokenWithUserAccount(
            appId,
            appCertificate,
            channelName,
            uid,
            role,
            tokenExpire,
            privilegeExpire
        )
    }

    static async buildTokenWithUserAccount(
        appId,
        appCertificate,
        channelName,
        account,
        role,
        tokenExpire,
        privilegeExpire = 0
    ) {
        let token = new AccessToken2(appId, appCertificate, 0, tokenExpire)

        let serviceRtc = new ServiceRtc(channelName, account)
        serviceRtc.add_privilege(ServiceRtc.kPrivilegeJoinChannel, privilegeExpire)
        if (role == Role.PUBLISHER) {
            serviceRtc.add_privilege(ServiceRtc.kPrivilegePublishAudioStream, privilegeExpire)
            serviceRtc.add_privilege(ServiceRtc.kPrivilegePublishVideoStream, privilegeExpire)
            serviceRtc.add_privilege(ServiceRtc.kPrivilegePublishDataStream, privilegeExpire)
        }
        token.add_service(serviceRtc)

        return await token.build()
    }

    static async buildTokenWithUidAndPrivilege(
        appId,
        appCertificate,
        channelName,
        uid,
        tokenExpire,
        joinChannelPrivilegeExpire,
        pubAudioPrivilegeExpire,
        pubVideoPrivilegeExpire,
        pubDataStreamPrivilegeExpire
    ) {
        return await this.BuildTokenWithUserAccountAndPrivilege(
            appId,
            appCertificate,
            channelName,
            uid,
            tokenExpire,
            joinChannelPrivilegeExpire,
            pubAudioPrivilegeExpire,
            pubVideoPrivilegeExpire,
            pubDataStreamPrivilegeExpire
        )
    }

    static async BuildTokenWithUserAccountAndPrivilege(
        appId,
        appCertificate,
        channelName,
        account,
        tokenExpire,
        joinChannelPrivilegeExpire,
        pubAudioPrivilegeExpire,
        pubVideoPrivilegeExpire,
        pubDataStreamPrivilegeExpire
    ) {
        let token = new AccessToken2(appId, appCertificate, 0, tokenExpire)

        let serviceRtc = new ServiceRtc(channelName, account)
        serviceRtc.add_privilege(ServiceRtc.kPrivilegeJoinChannel, joinChannelPrivilegeExpire)
        serviceRtc.add_privilege(ServiceRtc.kPrivilegePublishAudioStream, pubAudioPrivilegeExpire)
        serviceRtc.add_privilege(ServiceRtc.kPrivilegePublishVideoStream, pubVideoPrivilegeExpire)
        serviceRtc.add_privilege(ServiceRtc.kPrivilegePublishDataStream, pubDataStreamPrivilegeExpire)
        token.add_service(serviceRtc)

        return await token.build()
    }

    static async buildTokenWithRtm(appId, appCertificate, channelName, account, role, tokenExpire, privilegeExpire = 0) {
        let token = new AccessToken2(appId, appCertificate, 0, tokenExpire)

        let serviceRtc = new ServiceRtc(channelName, account)
        serviceRtc.add_privilege(ServiceRtc.kPrivilegeJoinChannel, privilegeExpire)
        if (role == Role.PUBLISHER) {
            serviceRtc.add_privilege(ServiceRtc.kPrivilegePublishAudioStream, privilegeExpire)
            serviceRtc.add_privilege(ServiceRtc.kPrivilegePublishVideoStream, privilegeExpire)
            serviceRtc.add_privilege(ServiceRtc.kPrivilegePublishDataStream, privilegeExpire)
        }
        token.add_service(serviceRtc)

        let serviceRtm = new ServiceRtm(account)
        serviceRtm.add_privilege(ServiceRtm.kPrivilegeLogin, tokenExpire)
        token.add_service(serviceRtm)

        return await token.build()
    }

    static async buildTokenWithRtm2(
        appId,
        appCertificate,
        channelName,
        rtcAccount,
        rtcRole,
        rtcTokenExpire,
        joinChannelPrivilegeExpire,
        pubAudioPrivilegeExpire,
        pubVideoPrivilegeExpire,
        pubDataStreamPrivilegeExpire,
        rtmUserId,
        rtmTokenExpire
    ) {
        let token = new AccessToken2(appId, appCertificate, 0, rtcTokenExpire)

        let serviceRtc = new ServiceRtc(channelName, rtcAccount)
        serviceRtc.add_privilege(ServiceRtc.kPrivilegeJoinChannel, joinChannelPrivilegeExpire)
        if (rtcRole == Role.PUBLISHER) {
            serviceRtc.add_privilege(ServiceRtc.kPrivilegePublishAudioStream, pubAudioPrivilegeExpire)
            serviceRtc.add_privilege(ServiceRtc.kPrivilegePublishVideoStream, pubVideoPrivilegeExpire)
            serviceRtc.add_privilege(ServiceRtc.kPrivilegePublishDataStream, pubDataStreamPrivilegeExpire)
        }
        token.add_service(serviceRtc)

        let serviceRtm = new ServiceRtm(rtmUserId)
        serviceRtm.add_privilege(ServiceRtm.kPrivilegeLogin, rtmTokenExpire)
        token.add_service(serviceRtm)

        return await token.build()
    }
}

window.RtcTokenBuilder = RtcTokenBuilder
window.RtcRole = Role
