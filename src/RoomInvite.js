/*
Copyright 2016 OpenMarket Ltd
Copyright 2017, 2018 New Vector Ltd

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import React from 'react';
import MatrixClientPeg from './MatrixClientPeg';
import MultiInviter from './utils/MultiInviter';
import Modal from './Modal';
import {getAddressType} from './UserAddress';
import createRoom from './createRoom';
import sdk from './';
import dis from './dispatcher';
import DMRoomMap from './utils/DMRoomMap';
import {_t} from './languageHandler';

/**
 * Invites multiple addresses to a room
 * Simpler interface to utils/MultiInviter but with
 * no option to cancel.
 *
 * @param {string} roomId The ID of the room to invite to
 * @param {string[]} addrs Array of strings of addresses to invite. May be matrix IDs or 3pids.
 * @returns {Promise} Promise
 */
function inviteMultipleToRoom(roomId, addrs) {
    const inviter = new MultiInviter(roomId);
    return inviter.invite(addrs).then(states => Promise.resolve({states, inviter}));
}

function _inviteToRoom(roomId, addr) {
    const addrType = getAddressType(addr);

    if (addrType === 'email') {
        return MatrixClientPeg.get().inviteByEmail(roomId, addr);
    } else if (addrType === 'mx-user-id') {
        return MatrixClientPeg.get().invite(roomId, addr);
    } else {
        throw new Error('Unsupported address');
    }
}

export function showStartChatInviteDialog() {
    const AddressPickerDialog = sdk.getComponent("dialogs.AddressPickerDialog");
    Modal.createTrackedDialog('Start a chat', '', AddressPickerDialog, {
        title: _t('Start a chat'),
        description: _t("Who would you like to communicate with?"),
        placeholder: _t("Email, name or matrix ID"),
        validAddressTypes: ['mx-user-id', 'email'],
        button: _t("Start Chat"),
        onFinished: _onStartChatFinished,
    });
}

export function showRoomInviteDialog(roomId) {
    const AddressPickerDialog = sdk.getComponent("dialogs.AddressPickerDialog");
    Modal.createTrackedDialog('Chat Invite', '', AddressPickerDialog, {
        title: _t('Invite new room members'),
        description: _t('Who would you like to add to this room?'),
        button: _t('Send Invites'),
        placeholder: _t("Email, name or matrix ID"),
        onFinished: (shouldInvite, addrs) => {
            _onRoomInviteFinished(roomId, shouldInvite, addrs);
        },
    });
}

/**
 * Checks if the given MatrixEvent is a valid 3rd party user invite.
 * @param {MatrixEvent} event The event to check
 * @returns {boolean} True if valid, false otherwise
 */
export function isValid3pidInvite(event) {
    if (!event || event.getType() !== "m.room.third_party_invite") return false;

    // any events without these keys are not valid 3pid invites, so we ignore them
    const requiredKeys = ['key_validity_url', 'public_key', 'display_name'];
    for (let i = 0; i < requiredKeys.length; ++i) {
        if (!event.getContent()[requiredKeys[i]]) return false;
    }

    // Valid enough by our standards
    return true;
}

function _onStartChatFinished(shouldInvite, addrs) {
    if (!shouldInvite) return;

    const ErrorDialog = sdk.getComponent("dialogs.ErrorDialog");
    const matrixClient = MatrixClientPeg.get();
    const addrTexts = addrs.map((addr) => addr.address)[0];
    const addrType = addrs.map((addr) => addr.addressType)[0];
    const addrKnown = addrs.map((addr) => addr.isKnown)[0];

    if (addrKnown === true) {
        matrixClient.lookupThreePid(addrType, addrTexts).then(res => {
            const invitedUserId = Object.entries(res).length === 0 ? addrTexts : res.mxid;
            const selectedRoom = _selectDirectChat(invitedUserId);
            const roomStatus = selectedRoom ? selectedRoom.status : null;
            switch (roomStatus) {
                case "join-join":
                    // Redirect to the existing room.
                    dis.dispatch({
                        action: 'view_room',
                        room_id: selectedRoom.room.roomId,
                    });
                    break;

                case "invite-join":
                    // Join room then redirect to this room.
                    matrixClient.joinRoom(selectedRoom.room.roomId).done(() => {
                        dis.dispatch({
                            action: 'view_room',
                            room_id: selectedRoom.room.roomId,
                        });
                    }, err => {
                        Modal.createTrackedDialog('Failed to join room', '', ErrorDialog, {
                            title: _t("Failed to join room"),
                            description: ((err && err.message) ? err.message : _t("Operation failed")),
                        });
                    });
                    break;

                case "join-invite":
                    // Redirect to the existing room.
                    dis.dispatch({
                        action: 'view_room',
                        room_id: selectedRoom.room.roomId,
                    });
                    break;

                case "join-leave":
                    // Send an invitation then redirect to the existing room.
                    _inviteToRoom(selectedRoom.room.roomId, addrTexts);
                    dis.dispatch({
                        action: 'view_room',
                        room_id: selectedRoom.room.roomId,
                    });
                    break;

                default:
                    // Create a new room.
                    createRoom({dmUserId: addrTexts}).catch((err) => {
                        Modal.createTrackedDialog('Failed to invite user', '', ErrorDialog, {
                            title: _t("Failed to invite user"),
                            description: ((err && err.message) ? err.message : _t("Operation failed")),
                        });
                    });
                    break;
            }
        }).catch(err => {
            Modal.createTrackedDialog('Failed to invite user', '', ErrorDialog, {
                title: _t("Failed to invite user"),
                description: ((err && err.message) ? err.message : _t("Operation failed")),
            });
        });
    } else if (addrKnown === false && addrType === "email") {
        // Case where a non-Tchap user is invited by email
    } else {
        // Error case (no email nor mxid).
        Modal.createTrackedDialog('Failed to invite user', '', ErrorDialog, {
            title: _t("Failed to invite user"),
            description: _t("Operation failed"),
        });
    }
}

function _onRoomInviteFinished(roomId, shouldInvite, addrs) {
    if (!shouldInvite) return;

    const addrTexts = addrs.map((addr) => addr.address);

    // Invite new users to a room
    inviteMultipleToRoom(roomId, addrTexts).then((result) => {
        const room = MatrixClientPeg.get().getRoom(roomId);
        return _showAnyInviteErrors(result.states, room, result.inviter);
    }).catch((err) => {
        console.error(err.stack);
        const ErrorDialog = sdk.getComponent("dialogs.ErrorDialog");
        Modal.createTrackedDialog('Failed to invite', '', ErrorDialog, {
            title: _t("Failed to invite"),
            description: ((err && err.message) ? err.message : _t("Operation failed")),
        });
    });
}

function _selectDirectChat(userId) {
    const roomList = _getDirectMessageRooms(userId);

    let selectedRoom = {
        room: null,
        status: null,
        date: null,
        weight: 0,
    };

    roomList.forEach(room => {
        const members = room.currentState.members;
        const him = members[userId];
        const myMembership = room.getMyMembership();
        const hisMembership = him.membership;

        const roomCreateEvent = room.currentState.getStateEvents("m.room.create");
        const roomCreateEventDate = roomCreateEvent[0] ? roomCreateEvent[0].event.origin_server_ts : 0;

        // Colliding all the "myMembership" and "hisMembership" possibilities.

        // "join" <=> "join" state.
        if (myMembership === "join" && hisMembership === "join") {
            if (selectedRoom === null || selectedRoom.weight < 4 ||
                (selectedRoom.weight === 4 && roomCreateEventDate < selectedRoom.date)) {
                selectedRoom = {room: room, status: "join-join", date: roomCreateEventDate, weight: 4};
            }

            // "invite" <=> "join" state.
            // I have received an invitation from the other member.
        } else if (myMembership === "invite" && hisMembership === "join") {
            if (selectedRoom === null || selectedRoom.weight < 3 ||
                (selectedRoom.weight === 3 && roomCreateEventDate < selectedRoom.date)) {
                selectedRoom = {room: room, status: "invite-join", date: roomCreateEventDate, weight: 3};
            }

            // "join" <=> "invite" state.
            // The other member already have an invitation.
        } else if (myMembership === "join" && hisMembership === "invite") {
            if (selectedRoom === null || selectedRoom.weight < 2 ||
                (selectedRoom.weight === 2 && roomCreateEventDate < selectedRoom.date)) {
                selectedRoom = {room: room, status: "join-invite", date: roomCreateEventDate, weight: 2};
            }

            // "join" <=> "leave" state.
            // The other member have left/reject my invitation.
        } else if (myMembership === "join" && hisMembership === "leave") {
            if (selectedRoom === null || selectedRoom.weight < 1 ||
                (selectedRoom.weight === 1 && roomCreateEventDate < selectedRoom.date)) {
                selectedRoom = {room: room, status: "join-leave", date: roomCreateEventDate, weight: 1};
            }
        } else {
            selectedRoom = {
                room: null,
                status: null,
                date: null,
                weight: 0,
            };
        }
    });
    selectedRoom = selectedRoom.room !== null && selectedRoom.status !== null && selectedRoom.date !== null ? selectedRoom : null;

    return selectedRoom;
}

function _showAnyInviteErrors(addrs, room, inviter) {
    // Show user any errors
    const failedUsers = Object.keys(addrs).filter(a => addrs[a] === 'error');
    if (failedUsers.length === 1 && inviter.fatal) {
        // Just get the first message because there was a fatal problem on the first
        // user. This usually means that no other users were attempted, making it
        // pointless for us to list who failed exactly.
        const ErrorDialog = sdk.getComponent("dialogs.ErrorDialog");
        Modal.createTrackedDialog('Failed to invite users to the room', '', ErrorDialog, {
            title: _t("Failed to invite users to the room:", {roomName: room.name}),
            description: inviter.getErrorText(failedUsers[0]),
        });
    } else {
        const errorList = [];
        for (const addr of failedUsers) {
            if (addrs[addr] === "error") {
                const reason = inviter.getErrorText(addr);
                errorList.push(addr + ": " + reason);
            }
        }

        if (errorList.length > 0) {
            const ErrorDialog = sdk.getComponent("dialogs.ErrorDialog");
            Modal.createTrackedDialog('Failed to invite the following users to the room', '', ErrorDialog, {
                title: _t("Failed to invite the following users to the %(roomName)s room:", {roomName: room.name}),
                description: errorList.join(<br />),
            });
        }
    }

    return addrs;
}

function _getDirectMessageRooms(addr) {
    const matrixClient = MatrixClientPeg.get();
    const currentUserId = matrixClient.getUserId();
    const rooms = matrixClient.getRooms();
    return rooms.filter((r) => {
        const users = Object.keys(r.currentState.members);
        if (users.length === 2 && users.includes(addr) && users.includes(currentUserId)) {
            return true;
        }
    });
}
