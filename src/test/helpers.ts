import request from 'supertest';

import app from '../index';

/**
 * Authenticated GET request.
 * @param path
 * @param token
 */
export function authGet(path: string, token: string) {
  return request(app).get(path).set('Authorization', `Bearer ${token}`);
}

/**
 * Authenticated POST request with CSRF header.
 * @param path
 * @param token
 * @param body
 */
export function authPost(path: string, token: string, body?: object) {
  const req = request(app)
    .post(path)
    .set('Authorization', `Bearer ${token}`)
    .set('X-Requested-With', 'XMLHttpRequest');
  return body ? req.send(body) : req;
}

/**
 * Authenticated PATCH request with CSRF header.
 * @param path
 * @param token
 * @param body
 */
export function authPatch(path: string, token: string, body?: object) {
  const req = request(app)
    .patch(path)
    .set('Authorization', `Bearer ${token}`)
    .set('X-Requested-With', 'XMLHttpRequest');
  return body ? req.send(body) : req;
}

/**
 * Authenticated PUT request with CSRF header.
 * @param path
 * @param token
 * @param body
 */
export function authPut(path: string, token: string, body?: object) {
  const req = request(app)
    .put(path)
    .set('Authorization', `Bearer ${token}`)
    .set('X-Requested-With', 'XMLHttpRequest');
  return body ? req.send(body) : req;
}

/**
 * Authenticated DELETE request with CSRF header.
 * @param path
 * @param token
 */
export function authDel(path: string, token: string) {
  return request(app)
    .delete(path)
    .set('Authorization', `Bearer ${token}`)
    .set('X-Requested-With', 'XMLHttpRequest');
}
