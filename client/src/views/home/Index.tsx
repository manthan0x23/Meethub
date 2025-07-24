import { useState } from "react";
import cuid from "cuid";
import { useNavigate } from "react-router-dom";
import { Button, TextField } from "@mui/material";
import lander from "../../assets/icon.png";

const HomeIndex = () => {
  const [roomId, setRoomId] = useState(cuid());
  const [name, setName] = useState<string | null>(null);
  const navigate = useNavigate();

  const EnterRoom = () => {
    if (!roomId?.trim()) {
      alert("Please enter a Room ID");
      return;
    }
    if (!name?.trim()) {
      alert("Please enter your name");
      return;
    }
    navigate(`/r/${roomId}/u/${name}`);
  };

  const onKeyEnter = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter") {
      EnterRoom();
    }
  };

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-blue-50 to-blue-100 flex flex-col justify-center items-center p-4">
      <div className="flex items-center gap-3 mb-8">
        <img src={lander} alt="Logo" className="h-10 w-10" />
        <h1 className="text-3xl md:text-4xl font-bold text-blue-700">
          Meethub
        </h1>
      </div>

      <div className="bg-white shadow-lg rounded-xl w-full max-w-md p-8 flex flex-col gap-6">
        <h2 className="text-2xl font-semibold text-center text-blue-600">
          Create or Join Room
        </h2>

        <TextField
          onKeyDown={onKeyEnter}
          type="text"
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
          placeholder="Room ID"
          label="Room ID"
          fullWidth
          size="small"
        />

        <TextField
          onKeyDown={onKeyEnter}
          type="text"
          value={name || ""}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your Name"
          label="Name"
          fullWidth
          size="small"
        />

        <Button
          onClick={EnterRoom}
          variant="contained"
          size="large"
          sx={{
            fontWeight: 600,
            textTransform: "none",
            backgroundColor: "#003CFF",
            "&:hover": {
              backgroundColor: "#002bbf",
            },
          }}
          fullWidth
        >
          Join
        </Button>
      </div>
    </div>
  );
};

export default HomeIndex;
