#!/bin/bash

#set -x




function start {
    rm -rf front_end/client/build/
    docker-compose up -d --build
    echo "To view logs, run the cmd: docker compose logs -f"
    echo "To stop display of logs: control-c"
}

function stop {
    docker-compose stop
}

function cleanup {
    docker-compose down --volumes
    docker-compose down --rmi all
    rm -rf front_end/client/build/
}


function usage() {
    echo "Error: Invalid options!"
    echo "USAGE:"
    echo " ./build.sh operation"
    echo "  Operation is one of start, stop or cleanup. The latter cleans temp data"
}

#main()
op=$1
if [[ "$op" == '' ]]
then
    echo "You need to specify an operation"
    usage
elif [[ "$op" == "start" ]]
then
    start
elif [[ "$op" == "stop" ]]
then
    stop
elif [[ "$op" == "restart" ]]
then
    stop
    start
elif [[ "$op" == "cleanup" ]]
then
    cleanup
elif [[ "$op" == "redo" ]]
then
    stop
    cleanup
    start
else
    echo "Bad operation: $op"
    usage
fi

