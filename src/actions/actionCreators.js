/*
Copyright 2017 New Vector Ltd

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

/**
 * Create an asynchronous action creator that will dispatch actions indicating
 * the current status of the promise returned by fn.
 * @param {string} id the id to give the dispatched actions. This is given a
 *                    suffix determining whether it is pending, successful or
 *                    a failure.
 * @param {function} fn a function that returns a Promise.
 * @returns {function} an asyncronous action creator - a function that uses its
 *                     single argument as a dispatch function.
 */
export function asyncAction(id, fn) {
    return (dispatch) => {
        dispatch({action: id + '.pending'});
        fn().then((result) => {
            dispatch({action: id + '.success', result});
        }).catch((err) => {
            dispatch({action: id + '.failure', err});
        });
    };
}