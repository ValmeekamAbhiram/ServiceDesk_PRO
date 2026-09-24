/**
 * ServiceDesk Pro — async route wrapper.
 *
 * Express 5 forwards a rejected promise to the error middleware on its own; Express 4
 * does not, and swallows it into an unhandled rejection while the client waits for a
 * response that never comes. One wrapper applied consistently makes the behaviour the
 * same either way, and makes every controller a single expression.
 *
 * It deliberately does not catch: `catch(next)` hands the error to
 * `middleware/error.ts`, which is the only place an error envelope is built.
 */
export function handler(fn) {
    return (req, res, next) => {
        void fn(req, res).catch(next);
    };
}
