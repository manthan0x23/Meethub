import { RtpCodecCapability } from "mediasoup/node/lib/RtpParameters";
import { WorkerLogLevel, WorkerLogTag } from "mediasoup/node/lib/Worker";
import { config as envConfig } from "dotenv";
import * as os from "os";

envConfig();
const ifaces = os.networkInterfaces();

function getLocalIPv4Address() {
  return String(process.env.LOCAL_IP!);
}

export const config = {
  app: {
    port: 5000,
    redis: {
      port: Number(process.env.REDIS_PORT) || 8200,
      channel: "channel",
      url: process.env.REDIS_URL,
      host: process.env.REDIS_HOST || "",
      password: process.env.REDIS_PASSWORD || "",
      username: process.env.REDIS_USERNAME || "",
    },
  },
  mediasoup: {
    // Worker settings
    numWorkers: Object.keys(os.cpus()).length,
    worker: {
      rtcMinPort: 10000,
      rtcMaxPort: 10100,
      logLevel: "debug" as WorkerLogLevel,
      logTags: [
        "info",
        "ice",
        "dtls",
        "rtp",
        "srtp",
        "rtcp",
        // 'rtx',
        // 'bwe',
        // 'score',
        // 'simulcast',
        // 'svc'
      ] as WorkerLogTag[],
    },
    // Router settings
    router: {
      mediaCodecs: [
        {
          kind: "audio",
          mimeType: "audio/opus",
          clockRate: 48000,
          channels: 2,
        },
        {
          kind: "video",
          mimeType: "video/VP8",
          clockRate: 90000,
          parameters: {
            "x-google-start-bitrate": 1000,
          },
        },
      ] as RtpCodecCapability[],
    },
    // WebRtcTransport settings
    webRtcTransport: {
      listenIps: [
        {
          ip: "0.0.0.0",
          announcedIp: getLocalIPv4Address(),
          family: 4,
        },
      ],
      maxIncomingBitrate: 1500000,
      initialAvailableOutgoingBitrate: 1000000,
    },
  },
};
