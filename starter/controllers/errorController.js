const AppError = require('../utils/appError');

const sendErrorDev = (err, res) => {
  res.status(err.statusCode).json({
    status: err.status,
    error: err,
    stack: err.stack,
    message: err.message,
  });
};

const sendErrorProd = (err, res) => {
  // Operational, trusted error: send message to client
  if (err.isOperational) {
    res.status(err.statusCode).json({
      status: err.status,
      message: err.message,
      //Remove below
      //   error: err,
    });
    // Programming or other unknown error: don't leak error details
  } else {
    // 1) Log Error
    console.error('ERROR 👹');
    // 2) Send generic message
    res.status(err.statusCode).json({
      status: 'error',
      message: 'Something went very wrong! 👹',
      //   Remove below
      //   error: err,
    });
  }
};

const handleCastErrorDB = (err) => {
  const message = `Invalid ${err.path}: ${err.value}`;
  return new AppError(message, 400);
};

const handleDuplicateFieldsDB = (err) => {
  const message = `Duplicate field value: ${err.keyValue.name}. Please use another value`;
  return new AppError(message, 400);
};

const handleValidationErrorDB = (err) => {
  //Change to object.values and use .map()
  const message = Object.keys(err.errors)
    .map((el) => `${el.toUpperCase()} ERROR: ${err.errors[el].message}`)
    .join('. ');

  return new AppError(message, 400);
};

module.exports = (err, req, res, next) => {
  // console.log(err.stack);
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  const errorName = err.name;
  console.log('Error name is: ------>', errorName);
  const errorCode = err.code;

  if (process.env.NODE_ENV === 'development') {
    sendErrorDev(err, res);
  } else if (process.env.NODE_ENV === 'production') {
    let error = { ...err };

    if (errorName === 'CastError') {
      error = handleCastErrorDB(error);
    }
    if (errorCode === 11000) {
      error = handleDuplicateFieldsDB(error);
    }
    if (errorName === 'ValidationError') {
      error = handleValidationErrorDB(error);
    }
    sendErrorProd(error, res);
  }
};
