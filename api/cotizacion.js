const nodemailer = require("nodemailer");
const { createHandler } = require("../lib/cotizacion");

module.exports = createHandler({ createTransport: nodemailer.createTransport });
