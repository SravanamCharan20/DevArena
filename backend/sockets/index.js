export const initSocket = (io) => {
    io.on("connection",(socket) => {
        console.log(socket.id);
    })
}


