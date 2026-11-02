const { DistributionAPI } = require('helios-core/common')

const ConfigManager = require('./configmanager')
const { resolveDistribution, RAW_URL } = require('./distroresolve')

// Remote distribution manifest resolution order:
//   1) env MAJAKGWI_DISTRO_URL (test override, exclusive)
//   2) GitHub contents API with Accept: application/vnd.github.raw (60s cache)
//   3) raw.githubusercontent.com refs/heads form (300s cache)
class MajakgwiDistributionAPI extends DistributionAPI {

    async pullRemote() {
        const data = await resolveDistribution()
        return { data, responseStatus: data == null ? 0 : 1 }
    }

}

exports.REMOTE_DISTRO_URL = RAW_URL

const api = new MajakgwiDistributionAPI(
    ConfigManager.getLauncherDirectory(),
    null, // Injected forcefully by the preloader.
    null, // Injected forcefully by the preloader.
    RAW_URL,
    false
)

exports.DistroAPI = api