// styles
import "../../styles/chat_scrollBar.css";

import { memo, useEffect, useRef, useState } from "react";
import { BsPeopleFill } from "react-icons/bs";
import { FaVideo } from "react-icons/fa";
import { FaPaperclip, FaVideoSlash } from "react-icons/fa6";
import { PiChatsTeardropDuotone, PiTelevisionSimple } from "react-icons/pi";
import { TbMicrophoneFilled, TbMicrophoneOff } from "react-icons/tb";
import { useParams } from "react-router-dom";
import { io, Socket } from "socket.io-client";
import { twMerge } from "tailwind-merge";
import {
  ChatMessage,
  config,
  ConsumerResult,
  Peer,
  sortAndBundleMessages,
  webRtcTransportParams,
  WebSocketEventType,
} from "../../config/config";
import Avvvatars from "avvvatars-react";
import moment from "moment";
import { Button, Dialog, Snackbar } from "@mui/material";
import { RxCross2 } from "react-icons/rx";
import { get_messages_chats_fromRedis } from "../../features/server_calls/get_message_redis";
import { post_message_toRedis } from "../../features/server_calls/post_message_redis";
import { MediaKind, RtpCapabilities } from "mediasoup-client/lib/RtpParameters";
import { Device } from "mediasoup-client";
import { Consumer, Producer, Transport } from "mediasoup-client/lib/types";
import { mergeData, MergedData } from "../../config/helpers/helpers";
import { MdCallEnd } from "react-icons/md";

export interface ProducerContainer {
  producer_id: string;
  userId: string;
}

export interface RemoteStream {
  consumer: Consumer;
  stream: MediaStream;
  kind: MediaKind;
  producerId: string;
}

const RoomIndex = () => {

  console.log(config.server);



  const { roomId, name } = useParams();
  const [IsVideoOn, setVideoOn] = useState(false);
  const [IsMicOn, setMicOn] = useState(false);
  const [IsWhiteBoardActive, setIsWhiteBoardActive] = useState(false);
  const [IsChatActive, setIsChatActive] = useState(false);
  const [showPeople, setShowPeople] = useState(false);
  const [usersInRoom, setUsersInRoom] = useState<Peer[]>([]);
  const [roomChatValue, setRoomChatValue] = useState<string | null>(null);
  const [roomChat, setRoomChat] = useState<ChatMessage[]>([]);
  const [remoteStreams, setRemoteStreams] = useState<RemoteStream[]>([]);
  const [producers, setProducers] = useState<ProducerContainer[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [notificationBar, setNotificationBar] = useState<{
    open: boolean;
    data: string;
  }>({ open: false, data: "" });

  const socketRef = useRef<Socket | null>(null);
  const DeviceRef = useRef<Device | null>(null);
  const ProducerRef = useRef<Transport | null>(null);
  const ConsumerRef = useRef<Transport | null>(null);
  const consumers = useRef<Map<string, Consumer>>(new Map());
  const videoProducer = useRef<Producer | null>(null);
  const audioProducer = useRef<Producer | null>(null);

  useEffect(() => {
    const socket = io(config.ws.url);
    socket.on("connect", () => {
      socketRef.current = socket;
      loadEverything();

      socket.onAny((event, args) => {
        routeIncommingEvents({ event, args });
      });
    });

    window.addEventListener("beforeunload", beforeunload);

    return () => {
      beforeunload();
      socket.disconnect();
    };
  }, [name, roomId]);

  useEffect(() => {
    getChatsFromServer();
  }, [name, roomId, IsChatActive]);

  useEffect(() => {
    producers.forEach((producer) => {
      consume(producer.producer_id);
    });
  }, [producers, roomId, name]);

  const getChatsFromServer = async () => {
    const data = await get_messages_chats_fromRedis(roomId!);
    console.log(data);

    if (data?.chats) {
      setRoomChat(data.chats);
    } else {
      setRoomChat([]);
    }
  };

  const routeIncommingEvents = ({
    event,
    args,
  }: {
    event: WebSocketEventType;
    args: any;
  }) => {
    switch (event) {
      case WebSocketEventType.USER_JOINED:
        userJoined(args);
        break;

      case WebSocketEventType.USER_LEFT:
        userLeft(args);
        break;

      case WebSocketEventType.USER_CHAT:
        changeRoomChat(args);
        break;

      case WebSocketEventType.NEW_PRODUCERS:
        newProducers(args);
        break;

      case WebSocketEventType.PRODUCER_CLOSED:
        closedProducers(args);
        break;

      default:
        break;
    }
  };

  const closedProducers = (args: ProducerContainer) => {
    setProducers((v) =>
      v.filter((prod) => prod.producer_id !== args.producer_id)
    );
  };

  const closeProducer = (producer_id: string) => {
    sendRequest(WebSocketEventType.CLOSE_PRODUCER, { producer_id });
  };

  const newProducers = (args: ProducerContainer[]) => {
    console.log(args);

    setProducers((v) => [...v, ...args]);
  };

  const getProducers = async () => {
    const producers = (await sendRequest(
      WebSocketEventType.GET_PRODUCERS,
      {}
    )) as ProducerContainer[];
    setProducers(producers);
  };

  const userLeft = (args: any) => {
    console.log("USER LEFT ARS", args);

    const user = args.user as Peer;
    setUsersInRoom((v) => v.filter((peer) => peer.id !== user.id));
  };
  const userJoined = (args: any) => {
    const user = args.user as Peer;
    setUsersInRoom((v) => [...v, user]);
    openSnackbar(args.message);
  };

  const changeRoomChat = (args: ChatMessage) => {
    console.log(args);

    setRoomChat((v) => [
      ...v,
      { ...args, createdAt: new Date(args.createdAt) },
    ]);
  };

  const beforeunload = async () => {
    await sendRequest(WebSocketEventType.EXIT_ROOM, {});
    socketRef.current?.disconnect();
  };

  const loadEverything = async () => {
    await createRoom();
    await joinRoom();
    await getCurrentUsers();
    await getRouterRTPCapabilties();
    await createConsumerTransport();
    await getProducers();
    await createProducerTransport();
  };

  const createRoom = async () => {
    await sendRequest(WebSocketEventType.CREATE_ROOM, { roomId });
  };
  const joinRoom = async () => {
    const resp = (await sendRequest(WebSocketEventType.JOIN_ROOM, {
      roomId,
      name,
    })) as { message: string };
    console.info(resp.message);
  };
  const getCurrentUsers = async () => {
    const users = (await sendRequest(
      WebSocketEventType.GET_IN_ROOM_USERS,
      {}
    )) as { users: Peer[] };
    setUsersInRoom(users.users);
  };

  const getRouterRTPCapabilties = async () => {
    const rtp = (await sendRequest(
      WebSocketEventType.GET_ROUTER_RTP_CAPABILITIES,
      {}
    )) as RtpCapabilities;
    if (!rtp) {
      console.error("Couldn't get RTP for device");
      return;
    }
    await loadDevice(rtp);
    return;
  };

  const loadDevice = async (rtp: RtpCapabilities) => {
    if (socketRef.current && !DeviceRef.current) {
      const device = new Device();
      await device.load({ routerRtpCapabilities: rtp });
      DeviceRef.current = device;
      console.log("--- Device Loaded successfully with RTP capabilities ---");
      return;
    } else {
      console.error(
        "Couldn't load device. check socket or theres current active device"
      );
      return;
    }
  };

  const createProducerTransport = async () => {
    if (DeviceRef.current && socketRef.current) {
      console.log("resp");

      const resp = (await sendRequest(
        WebSocketEventType.CREATE_WEBRTC_TRANSPORT,
        {
          forceTcp: false,
          rtpCapabilities: DeviceRef.current.rtpCapabilities,
        }
      )) as { params: webRtcTransportParams };
      console.log(resp);

      ProducerRef.current = DeviceRef.current.createSendTransport(resp.params);

      console.log("--- CREATE PRODUCER TRANSPORT ---");

      if (ProducerRef.current) {
        try {
          ProducerRef.current.on("connect", ({ dtlsParameters }, cb, eb) => {
            sendRequest(WebSocketEventType.CONNECT_TRANSPORT, {
              transport_id: ProducerRef.current!.id,
              dtlsParameters,
            })
              .then(cb)
              .catch(eb);
          });

          ProducerRef.current.on(
            "produce",
            async ({ kind, rtpParameters }, cb, eb) => {
              try {
                const { producer_id } = (await sendRequest(
                  WebSocketEventType.PRODUCE,
                  {
                    producerTransportId: ProducerRef.current!.id,
                    kind,
                    rtpParameters,
                  }
                )) as { producer_id: string };

                console.log(producer_id);

                cb({ id: producer_id });
              } catch (error) {
                console.log(error);

                eb(new Error(String(error)));
              }
            }
          );

          ProducerRef.current.on("connectionstatechange", (state) => {
            console.log(state);
            switch (state) {
              case "disconnected":
                console.log("Producer disconnected");
                break;
            }
          });

          return true;
        } catch (error) {
          console.log("Producer Creation error :: ", error);
        }
      }
    }
  };

  const createConsumerTransport = async () => {
    if (ConsumerRef.current) {
      console.log("Already initialized a consumer transport");
      return;
    }
    try {
      const data = (await sendRequest(
        WebSocketEventType.CREATE_WEBRTC_TRANSPORT,
        { forceTcp: false }
      )) as { params: webRtcTransportParams };

      if (!data) {
        throw new Error("No Transport created");
      }
      console.log("Consumer Transport :: ", data);
      if (!DeviceRef.current || !socketRef.current) {
        console.error("No devie or socket found");
        return;
      }
      ConsumerRef.current = DeviceRef.current.createRecvTransport(data.params);

      ConsumerRef.current.on("connect", async ({ dtlsParameters }, cb, eb) => {
        sendRequest(WebSocketEventType.CONNECT_TRANSPORT, {
          transport_id: ConsumerRef.current!.id,
          dtlsParameters,
        })
          .then(cb)
          .catch(eb);
      });

      ConsumerRef.current.on("connectionstatechange", (state) => {
        console.log("Consumer state", state);
        if (state === "connected") {
          console.log("--- Connected Consumer Transport ---");
        }
        if (state === "disconnected") {
          ConsumerRef.current?.close();
        }
      });

      (await sendRequest(WebSocketEventType.GET_PRODUCERS, {})) as {
        producer_id: string;
      }[];
    } catch (error) {
      console.log("error creating consumer transport", error);
    }
  };

  function sendRequest(type: WebSocketEventType, data: any) {
    return new Promise((resolve, reject) => {
      if (!socketRef.current) {
        alert("No socket state active");
        return;
      }
      socketRef.current.emit(type, data, (response: any, err: any) => {
        if (!err) {
          resolve(response);
        } else {
          reject(err);
        }
      });
    });
  }

  const sendRoomChat = (msg: ChatMessage) => {
    if (msg.data && roomId) {
      sendRequest(WebSocketEventType.USER_CHAT, {
        ...msg,
        data: msg.data,
      });
      setRoomChatValue(null);
      post_message_toRedis(msg, roomId);
    }
  };

  const consume = (producerId: string) => {
    getConsumerStream(producerId).then((data) => {
      if (!data) {
        console.log("Couldn't load stream");
        return;
      }
      console.log("CONSUME STREAM DATA", data);

      const { consumer, kind } = data;
      consumers.current.set(consumer.id, consumer);
      if (kind === "video" || kind === "audio") {
        setRemoteStreams((v) => [...v, data]);
      }
    });
  };

  const getConsumerStream = async (producerId: string) => {
    if (!DeviceRef.current) {
      console.log("No device found");
      return;
    }
    if (!ConsumerRef.current) {
      console.warn("No current consumer transport");
      return;
    }
    const rtpCapabilities = DeviceRef.current.rtpCapabilities;
    const data = (await sendRequest(WebSocketEventType.CONSUME, {
      rtpCapabilities,
      consumerTransportId: ConsumerRef.current.id,
      producerId,
    })) as ConsumerResult;

    const { id, kind, rtpParameters } = data;

    console.log("ConSUMER DATA :: ", data);

    const consumer = await ConsumerRef.current.consume({
      id,
      producerId,
      kind,
      rtpParameters,
    });

    const stream = new MediaStream();
    stream.addTrack(consumer.track);

    return {
      consumer,
      stream,
      kind,
      producerId,
    };
  };

  const turnMicOn = async () => {
    if (!IsMicOn) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioStream = stream.getAudioTracks()[0];

      if (ProducerRef.current) {
        audioProducer.current = await ProducerRef.current.produce({
          track: audioStream,
        });
      }

      //@ts-ignore
      window.localAudioStream = stream;

      setMicOn(true);
    } else {
      // Stop the audio track and release the microphone
      //@ts-ignore
      if (window.localAudioStream) {
        //@ts-ignore
        window.localAudioStream.getTracks().forEach((track) => track.stop());
        //@ts-ignore
        window.localAudioStream = null;
      }

      if (audioProducer.current) {
        closeProducer(audioProducer.current.id);
        audioProducer.current.close();
      }

      // Set the state or a variable to indicate that the microphone is off
      setMicOn(false);
    }
  };

  const turnVideoOn = async () => {
    if (!IsVideoOn) {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      const videoStream = stream.getVideoTracks()[0];

      if (ProducerRef.current) {
        videoProducer.current = await ProducerRef.current.produce({
          track: videoStream,
        });
      }

      //@ts-ignore
      window.localStream = stream;
      setLocalStream(stream);

      setVideoOn(true);
    } else {
      //@ts-ignore
      if (window.localStream) {
        //@ts-ignore
        window.localStream.getTracks().forEach((track) => track.stop());
        //@ts-ignore
        window.localStream = null;
      }
      if (videoProducer.current) {
        closeProducer(videoProducer.current.id);
        videoProducer.current.close();
        setLocalStream(null);
      }

      setVideoOn(false);
    }
  };

  const openSnackbar = (data: string) => {
    setNotificationBar({
      data,
      open: true,
    });

    setTimeout(() => {
      setNotificationBar({
        data: "",
        open: false,
      });
    }, 3000);
  };

  const closeSnackBar = () => {
    setNotificationBar({
      data: "",
      open: false,
    });
  };

  return (
    <div className="h-screen w-screen bg-gradient-to-br from-gray-900 via-slate-900 to-black flex flex-col overflow-hidden text-white">
      <div className="h-full w-full flex justify-center items-center p-2 lg:p-4">
        {/* Control Panel */}
        <div className="h-full w-16 lg:w-20 flex flex-col justify-center items-center gap-2 lg:gap-4 transition-all">
          <div
            onClick={turnVideoOn}
            className={twMerge(
              "group transition-all duration-300 h-12 w-12 lg:h-14 lg:w-14 border-2 bg-white/95 hover:bg-white hover:scale-110 cursor-pointer text-blue-600 text-lg lg:text-xl flex justify-center items-center rounded-full shadow-lg hover:shadow-xl backdrop-blur-sm",
              !IsVideoOn && "text-red-500 bg-red-50 border-red-200 hover:bg-red-100"
            )}
          >
            {IsVideoOn ? <FaVideo /> : <FaVideoSlash />}
          </div>
          
          <div
            onClick={turnMicOn}
            className={twMerge(
              "group transition-all duration-300 h-12 w-12 lg:h-14 lg:w-14 border-2 bg-white/95 hover:bg-white hover:scale-110 cursor-pointer text-blue-600 text-lg lg:text-xl flex justify-center items-center rounded-full shadow-lg hover:shadow-xl backdrop-blur-sm",
              !IsMicOn && "text-red-500 bg-red-50 border-red-200 hover:bg-red-100"
            )}
          >
            {IsMicOn ? <TbMicrophoneFilled /> : <TbMicrophoneOff />}
          </div>
          
          <div
            onClick={() => setIsChatActive((v) => !v)}
            className={twMerge(
              "group transition-all duration-300 h-12 w-12 lg:h-14 lg:w-14 border-2 bg-white/95 hover:bg-white hover:scale-110 cursor-pointer text-gray-700 hover:text-blue-600 text-xl lg:text-2xl flex justify-center items-center rounded-full shadow-lg hover:shadow-xl backdrop-blur-sm",
              IsChatActive && "text-blue-600 bg-blue-50 border-blue-200"
            )}
          >
            <PiChatsTeardropDuotone />
          </div>
          
          <div
            onClick={() => setIsWhiteBoardActive((v) => !v)}
            className={twMerge(
              "group transition-all duration-300 h-12 w-12 lg:h-14 lg:w-14 border-2 bg-white/95 hover:bg-white hover:scale-110 cursor-pointer text-gray-700 hover:text-blue-600 text-xl lg:text-2xl flex justify-center items-center rounded-full shadow-lg hover:shadow-xl backdrop-blur-sm",
              IsWhiteBoardActive && "text-blue-600 bg-blue-50 border-blue-200"
            )}
          >
            <PiTelevisionSimple />
          </div>
          
          <div
            onClick={() => setShowPeople((v) => !v)}
            className={twMerge(
              "relative group transition-all duration-300 h-12 w-12 lg:h-14 lg:w-14 border-2 bg-white/95 hover:bg-white hover:scale-110 cursor-pointer text-gray-700 hover:text-blue-600 text-xl lg:text-2xl flex justify-center items-center rounded-full shadow-lg hover:shadow-xl backdrop-blur-sm",
              showPeople && "text-blue-600 bg-blue-50 border-blue-200"
            )}
          >
            <BsPeopleFill />
            <div className="absolute -right-1 -top-1 h-5 w-5 lg:h-6 lg:w-6 flex items-center justify-center text-xs lg:text-sm bg-gradient-to-r from-red-500 to-red-600 font-semibold text-white rounded-full shadow-md animate-pulse">
              {usersInRoom.length + 1}
            </div>
          </div>
          
          <div
            onClick={() => {
              navigator.clipboard.writeText(roomId!).then(() => {
                openSnackbar("Room Id copied to clipboard");
              });
            }}
            className="group transition-all duration-300 h-12 w-12 lg:h-14 lg:w-14 bg-white/10 hover:bg-white/20 border border-white/20 hover:border-white/40 cursor-pointer text-white/60 hover:text-white hover:scale-110 text-lg lg:text-xl flex justify-center items-center rounded-full backdrop-blur-sm shadow-lg"
          >
            <FaPaperclip />
          </div>
          
          <div
            onClick={() => {
              window.location.assign("/");
            }}
            className="group transition-all duration-300 h-12 w-12 lg:h-14 lg:w-14 bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white hover:scale-110 cursor-pointer text-xl lg:text-2xl flex justify-center items-center rounded-full shadow-lg hover:shadow-xl"
          >
            <MdCallEnd />
          </div>
        </div>

        {/* Video Grid */}
        <div className="h-full flex-1 p-2 lg:p-4 overflow-hidden">
          <div className="h-full w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 lg:gap-4 auto-rows-fr">
            <LocalUserPannel stream={localStream} name={name!} />
            <UserCarousel
              usersInRoom={usersInRoom}
              remoteStreams={remoteStreams}
              producerContainer={producers}
              userId={socketRef.current?.id}
            />
          </div>
        </div>

        {/* Chat Dialog */}
        <Dialog 
          open={IsChatActive}
          maxWidth="md"
          fullWidth
          PaperProps={{
            style: {
              backgroundColor: 'transparent',
              boxShadow: 'none',
              margin: '16px',
            }
          }}
        >
          <div className="h-[80vh] max-h-[600px] w-full bg-gray-900/95 backdrop-blur-md border border-gray-700/50 text-white/90 flex flex-col rounded-2xl shadow-2xl">
            {/* Chat Header */}
            <div className="flex-shrink-0 h-16 w-full flex justify-between items-center px-6 border-b border-gray-700/50">
              <h2 className="font-semibold text-xl lg:text-2xl bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                Chat
              </h2>
              <button
                className="text-gray-400 hover:text-white text-xl lg:text-2xl cursor-pointer transition-colors duration-200 p-2 hover:bg-gray-800/50 rounded-full"
                onClick={() => setIsChatActive(false)}
              >
                <RxCross2 />
              </button>
            </div>
            
            {/* Chat Messages */}
            <div className="flex-1 px-6 py-4 overflow-hidden">
              {roomChat && (
                <RoomChat
                  roomChat={roomChat}
                  userId={socketRef.current?.id!}
                />
              )}
            </div>
            
            {/* Chat Input */}
            <div className="flex-shrink-0 h-16 px-6 pb-4 flex items-center gap-3">
              <input
                onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
                  if (event.key === "Enter") {
                    const message = {
                      user: { id: socketRef.current!.id!, name: name! },
                      data: roomChatValue,
                      createdAt: new Date(),
                    };
                    if (message.data !== null) {
                      //@ts-ignore
                      setRoomChat((v) => [...v, message]);
                      //@ts-ignore
                      sendRoomChat(message);
                    }
                  }
                }}
                value={roomChatValue || ""}
                onChange={(e) => {
                  setRoomChatValue(e.target.value);
                }}
                placeholder="Type your message..."
                className="flex-1 bg-gray-800/50 border border-gray-600/50 focus:border-blue-400/50 focus:ring-2 focus:ring-blue-400/20 rounded-xl px-4 py-3 text-white placeholder-gray-400 outline-none transition-all duration-200"
              />
              <button
                onClick={() => {
                  const message = {
                    user: { id: socketRef.current!.id!, name: name! },
                    data: roomChatValue?.trim(),
                    createdAt: new Date(),
                  };
                  if (message.data !== null) {
                    // @ts-ignore
                    setRoomChat((v) => [...v, message]);
                    // @ts-ignore
                    sendRoomChat(message);
                  }
                }}
                className="px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 rounded-xl text-white font-medium transition-all duration-200 hover:scale-105 shadow-lg"
              >
                Send
              </button>
            </div>
          </div>
        </Dialog>
      </div>
      
      {/* Enhanced Snackbar */}
      <Snackbar
        open={notificationBar.open}
        autoHideDuration={6000}
        message={notificationBar.data}
        action={
          <Button 
            onClick={closeSnackBar} 
            sx={{ 
              color: '#60a5fa',
              '&:hover': {
                backgroundColor: 'rgba(96, 165, 250, 0.1)'
              }
            }}
            size="small"
          >
            <RxCross2 />
          </Button>
        }
        anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
        sx={{
          '& .MuiSnackbarContent-root': {
            backgroundColor: 'rgba(17, 24, 39, 0.95)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(75, 85, 99, 0.3)',
            borderRadius: '12px',
            color: 'white',
          }
        }}
      />
    </div>
  );
};

const RoomChat = ({
  roomChat,
  userId,
}: {
  roomChat: ChatMessage[];
  userId: string;
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bundledChat = sortAndBundleMessages(roomChat);

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [roomChat]);
  
  return (
    <div
      ref={scrollRef}
      className="h-full w-full flex flex-col overflow-y-auto overflow-x-hidden chatScrollBar space-y-4"
    >
      {bundledChat &&
        bundledChat.map((bundle, index) => (
          <div
            key={index}
            className="flex flex-col gap-3 animate-in slide-in-from-bottom-2 duration-300"
          >
            {/* User Info */}
            <div className="flex justify-start items-center gap-3">
              <div className="flex-shrink-0">
                <Avvvatars value={bundle.user.name} size={32} />
              </div>
              <div className="flex flex-col">
                <p className={twMerge(
                  "font-medium text-sm lg:text-base",
                  bundle.user.id === userId ? "text-blue-400" : "text-white"
                )}>
                  {bundle.user.id === userId ? "You" : bundle.user.name}
                </p>
                <p className="text-xs text-gray-400">
                  {moment(bundle.messages[0].createdAt).format("LT")}
                </p>
              </div>
            </div>

            {/* Messages */}
            <div className="flex flex-col space-y-2 ml-11">
              {bundle.messages.map((chat, messageIndex) => (
                <div
                  key={messageIndex}
                  className="flex items-start"
                >
                  <div className={twMerge(
                    "inline-block px-4 py-2 rounded-2xl max-w-sm lg:max-w-md break-words",
                    bundle.user.id === userId 
                      ? "bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg" 
                      : "bg-gray-700/50 text-white border border-gray-600/50"
                  )}>
                    <p className="text-sm lg:text-base leading-relaxed">{chat.data}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
    </div>
  );
};

const LocalUserPannel = ({
  stream,
  name,
}: {
  stream: null | MediaStream;
  name: string;
}) => {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  
  useEffect(() => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
      localVideoRef.current.play();
      localVideoRef.current.volume = 0;
      localVideoRef.current.autoplay = true;
    }
  }, [stream]);
  
  return (
    <div className="relative overflow-hidden bg-gradient-to-br from-gray-800/50 to-gray-900/50 backdrop-blur-sm border border-gray-700/50 rounded-2xl shadow-xl group hover:shadow-2xl transition-all duration-300 aspect-video">
      {stream ? (
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          className="h-full w-full object-cover rounded-2xl"
        />
      ) : (
        <div className="h-full w-full flex flex-col items-center justify-center">
          <div className="mb-4 opacity-80 group-hover:opacity-100 transition-opacity duration-300">
            <Avvvatars value={name} size={60} />
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent rounded-2xl" />
        </div>
      )}
      
      {/* User Label */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 rounded-b-2xl">
        <p className="text-white font-medium text-sm lg:text-base truncate">
          You ({name})
        </p>
      </div>
      
      {/* Online Indicator */}
      <div className="absolute top-3 right-3">
        <div className="h-3 w-3 bg-green-400 rounded-full animate-pulse shadow-lg"></div>
      </div>
    </div>
  );
};

const UserCarousel = ({
  usersInRoom,
  remoteStreams,
  producerContainer,
}: {
  usersInRoom: Peer[];
  remoteStreams: RemoteStream[];
  producerContainer: ProducerContainer[];
  userId?: string;
}) => {
  const users = mergeData(usersInRoom, remoteStreams, producerContainer);
  console.log("USERS", users);

  return (
    <>
      {users.map((user) => (
        <div
          key={user.userId}
          className="relative overflow-hidden bg-gradient-to-br from-gray-800/50 to-gray-900/50 backdrop-blur-sm border border-gray-700/50 rounded-2xl shadow-xl group hover:shadow-2xl transition-all duration-300 aspect-video"
        >
          {user.producers.length <= 0 ? (
            <div className="h-full w-full flex flex-col items-center justify-center">
              <div className="mb-4 opacity-80 group-hover:opacity-100 transition-opacity duration-300">
                <Avvvatars value={user.name} size={60} />
              </div>
              <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent rounded-2xl" />
              
              {/* User Label */}
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 rounded-b-2xl">
                <p className="text-white font-medium text-sm lg:text-base truncate">
                  {user.name}
                </p>
              </div>
              
              {/* Online Indicator */}
              <div className="absolute top-3 right-3">
                <div className="h-3 w-3 bg-green-400 rounded-full animate-pulse shadow-lg"></div>
              </div>
            </div>
          ) : (
            <MemoizedUserPannel user={user} />
          )}
        </div>
      ))}
    </>
  );
};

const UserPannel = ({ user }: { user: MergedData }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    user.producers.forEach((producer) => {
      if (producer.kind === "video" && videoRef.current) {
        videoRef.current.srcObject = producer.stream;
        videoRef.current.play();
        videoRef.current.volume = 0;
        videoRef.current.autoplay = true;
      } else if (producer.kind === "audio" && audioRef.current) {
        audioRef.current.srcObject = producer.stream;
        audioRef.current.play();
        audioRef.current.autoplay = true;
      }
    });
  }, [user]);

  const hasVideo = user.producers.some(p => p.kind === "video");
  const hasAudio = user.producers.some(p => p.kind === "audio");

  if (!hasVideo && hasAudio) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center relative">
        <div className="mb-4 opacity-80 group-hover:opacity-100 transition-opacity duration-300">
          <Avvvatars value={user.name} size={60} />
        </div>
        <audio ref={audioRef} autoPlay />
        
        {/* Audio Wave Animation */}
        <div className="absolute bottom-20 flex space-x-1">
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              className="w-1 bg-blue-400 rounded-full animate-pulse"
              style={{
                height: '20px',
                animationDelay: `${i * 0.1}s`,
                animationDuration: '0.8s'
              }}
            />
          ))}
        </div>
        
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent rounded-2xl" />
        
        {/* User Label */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 rounded-b-2xl">
          <p className="text-white font-medium text-sm lg:text-base truncate">
            {user.name}
          </p>
        </div>
        
        {/* Online Indicator */}
        <div className="absolute top-3 right-3">
          <div className="h-3 w-3 bg-green-400 rounded-full animate-pulse shadow-lg"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full relative group">
      <video 
        ref={videoRef} 
        autoPlay 
        playsInline 
        className="h-full w-full object-cover rounded-2xl" 
      />
      <audio ref={audioRef} autoPlay playsInline />
      
      {/* User Label */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 rounded-b-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300">
        <p className="text-white font-medium text-sm lg:text-base truncate">
          {user.name}
        </p>
      </div>
      
      {/* Online Indicator */}
      <div className="absolute top-3 right-3">
        <div className="h-3 w-3 bg-green-400 rounded-full animate-pulse shadow-lg"></div>
      </div>
      
      {/* Audio/Video Status Icons */}
      <div className="absolute top-3 left-3 flex space-x-2">
        {hasAudio && (
          <div className="bg-black/50 backdrop-blur-sm rounded-full p-2">
            <TbMicrophoneFilled className="text-green-400 text-sm" />
          </div>
        )}
        {hasVideo && (
          <div className="bg-black/50 backdrop-blur-sm rounded-full p-2">
            <FaVideo className="text-blue-400 text-sm" />
          </div>
        )}
      </div>
    </div>
  );
};

const MemoizedUserPannel = memo(UserPannel);

export default RoomIndex;