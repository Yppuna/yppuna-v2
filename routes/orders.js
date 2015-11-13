var express = require('express');
var app = express();
var router = express.Router();
var mongoose = require("mongoose");
var nodemailer = require('nodemailer');
var smtpTransport = require('nodemailer-smtp-transport');
var User = require('../models/user');
var Product = require('../models/product');
var Order = require('../models/order');
var i18n = require('i18n');
var config = require('config');
var extend = require('util')._extend;
var request = require("request");
var slack = require('slack-notify')(config.get("Slack.webhookUrl"));


var transporter = nodemailer.createTransport(smtpTransport({
    host: config.get('Nodemailer.host'),
    auth: {
        user: config.get('Nodemailer.auth.user'),
        pass: config.get('Nodemailer.auth.pass')
    }
}));

// As with any middleware it is quintessential to call next()
// if the user is authenticated
var isAuthenticated = function (req, res, next) {
  if (req.isAuthenticated())
    return next();
  res.redirect('/login');
}

var isAdmin = function (req, res, next) {
  if (req.isAuthenticated() && req.user.admin === true)
    return next();
  res.redirect('/login');
}

var hasShipping = function(obj) {
  if (!obj.shipping)
    return false;
  if (obj.shipping.full_name && obj.shipping.phone_number && obj.shipping.country && obj.shipping.address && obj.shipping.zipcode)
    return true;
  return false;
}

var reservePayco = function(order) {
  var payco = {
    "sellerKey": config.get("Payco.sellerKey"),
    "sellerOrderReferenceKey": order._id,
    "totalOrderAmt": order.product.price,
    "totalDeliveryFeeAmt": 0,
    "totalPaymentAmt": order.product.price,
    "returnUrl": config.get("Payco.returnUrl"),
    "returnUrlParam" : "{\"order_id\":\""+order._id+"\"}",
    "orderMethod": "EASYPAY",
    "payMode": "PAY2",
    "orderProducts": [
        {
          "cpId": config.get("Payco.cpId"),
          "productId": config.get("Payco.productId"),
          "productAmt": order.product.price,
          "productPaymentAmt": order.product.price,
          "sortOrdering": 1,
          "productName": order.product.name,
          "orderQuantity": 1,
          "sellerOrderProductReferenceKey": order._id,
          //"productImageUrl": "http://dailyboom.co/uploads/"+order.product.images[0]
        }
    ]
  };

  return payco;
}

router.get('/orders/:id', isAdmin, function(req, res) {
  Order.findOne({ _id: req.params.id }).populate('product').exec(function(err, order) {
    if (err)
      console.log(err);
    if (!order)
      res.redirect('/');
    res.render('orders/view', { order: order });
  });
});

router.post('/orders/new', isAuthenticated, function(req, res) {
  var order = new Order({
    user: req.user.id,
    product: req.query.product_id,
    status: "Submitted"
  })

  order.save(function(err) {
    if (err) res.redirect("/");
    else res.redirect("/");
  });
});


router.get('/checkout', function(req, res) {
  if (!req.query.product_id && !req.session.product && !req.session.order)
    return res.redirect('/');

  if (req.session.product && (req.session.product != req.query.product_id)) {
    delete req.session.order;
    delete req.session.product;
  }
  if (!req.session.order) {
    var order = new Order({
      product: req.query.product_id ? req.query.product_id : req.session.product,
      status: "Submitted"
    })

    if (req.user) {
      order.user = req.user.id;
    }

    order.save(function(err) {
      if (err) res.redirect("/");
      req.session.order = order.id;
      if (!req.session.product)
        req.session.product = req.query.product_id;
      if ((req.user && hasShipping(req.user))) {
        order.populate('product', function(err, orderPop) {
          var payco = reservePayco(orderPop);
          request.post(
              'https://alpha-api-bill.payco.com/outseller/order/reserve',
              { json: payco },
              function (error, response, body) {
                  console.log(body)
                  if (!error && body.code == 0) {
                      res.render('checkout', { order: orderPop, orderSheetUrl: body.result.orderSheetUrl });
                  }
              }
          );
        })
      }
      else
        res.redirect('/shipping');
    });
  }
  else {
    Order.findOne({ '_id': req.session.order }, function(err, order) {
      if ((req.user && hasShipping(req.user)) || (hasShipping(order))) {
        order.populate('product', function(err, orderPop) {
          if (!req.session.product)
            req.session.product = orderPop.product.id;
          var payco = reservePayco(orderPop);
          request.post(
              'https://alpha-api-bill.payco.com/outseller/order/reserve',
              { json: payco },
              function (error, response, body) {
                  console.log(body)
                  if (!error && body.code == 0) {
                      res.render('checkout', { order: orderPop, orderSheetUrl: body.result.orderSheetUrl });
                  }
              }
          );
        })
      }
      else
        res.redirect('/shipping');
    });
  }
});

router.get('/payco_callback', function(req, res) {
  console.log(req.query);
  if (req.query.code == 0) {
        var payco = {
          "sellerKey" : config.get("Payco.sellerKey"),
          "reserveOrderNo" : req.query.reserveOrderNo,
          "sellerOrderReferenceKey": req.query.sellerOrderReferenceKey,
          "paymentCertifyToken" : req.query.paymentCertifyToken,
          "totalPaymentAmt": req.query.totalPaymentAmt
        }
        request.post(
              'https://alpha-api-bill.payco.com/outseller/payment/approval',
              { json: payco },
              function (error, response, body) {
                  console.log(body)
                  if (!error && body.code == 0) {
                    Order.findOne({ _id: req.query.order_id }, function(err, order) {
                      order.payco.orderNo = body.result.orderNo;
                      order.payco.sellerOrderReferenceKey = body.result.sellerOrderReferenceKey;
                      order.payco.orderCertifyKey = body.result.orderCertifyKey;
                      order.payco.totalOrderAmt = body.result.totalOrderAmt;
                      order.payco.paymentDetails = body.result.paymentDetails;
                      order.status = "Payed";
                      order.save(function(err) {
                        Product.findOne({ _id: order.product }, function(err, product) {
                          product.current_quantity -= 1;
                          product.save(function(err) {
                            if (app.get("env") === "production") {
                              slack.send({
                                channel: '#dailyboom-new-order',
                                icon_url: 'http://dailyboom.co/images/favicon/favicon-96x96.png',
                                text: 'New order #'+order._id,
                                unfurl_links: 1,
                                username: 'DailyBoom-bot'
                              });
                            }
                            res.render('payco_callback', {code: req.query.code});
                          });
                        });
                      });
                    });
                  }
                  else {
                    res.render('payco_callback', { msg: body.message, code: req.query.code });
                  }
              }
          );
  }
  else {
    res.render('payco_callback', { msg: "ERROR", code: req.query.code });
  }
});

router.get('/success', function(req, res) {
  if (!req.session.order)
    res.redirect('/');
  delete req.session.order;
  res.render('success', { msg: " ", code: req.query.code });
});

router.get('/orders/cancel/:id', function(req, res) {
  Order.findOne({ _id: req.params.id }, function(err, order) {
    if (err)
      console.log(err);
    if (!order)
      res.redirect('/mypage');
    var payco = {
      "sellerKey" : config.get("Payco.sellerKey"),
      "orderNo" : order.payco.orderNo,
      "sellerOrderReferenceKey": order.payco.sellerOrderReferenceKey,
      "paymentCertifyToken" : order.payco.orderCertifyToken,
      "cancelTotalAmt": order.payco.totalOrderAmt
    };
    request.post(
      'https://alpha-api-bill.payco.com/outseller/order/cancel/request',
      { json: payco },
      function (error, response, body) {
          console.log(body)
          if (!error && body.code == 0) {
            order.status = "Cancelled";
            order.payco.cancelTradeSeq = body.result.cancelTradeSeq;
            order.payco.cancelPaymentDetails = body.result.cancelPaymentDetails;
            order.save(function(err) {
              if (err)
                console.log(err);
              res.redirect('/mypage');
            });
          }
      }
  );
  });
});

router.get('/shipping', function(req, res) {
  if (!req.session.order)
    res.redirect('/');
  else
    res.render('shipping');
});

router.post('/shipping', function(req, res) {
  if (!req.session.order)
    return res.redirect('/');
  Order.findOne({ '_id': req.session.order }, function(err, order) {
    if (err) {
      console.log(err);
      return res.redirect('/');
    }
    req.Validator.validate('full_name', i18n.__('user.fullName'), {
        required: true
      })
      .validate('phone_number', i18n.__('user.phoneNumber'), {
        required: true,
        numeric: true
      })
      .validate('address1', i18n.__('user.address1'), {
        required: true
      })
      .validate('zipcode', i18n.__('user.zipcode'), {
        required: true,
        numeric: true
      })
      .validate('country', i18n.__('user.country'), {
        required: true
      });

      if (req.body.add_id && !req.user) {
          req.Validator.validate('username', i18n.__('user.username'), {
            length: {
              min: 3,
              max: 20
            },
            required: true
          })
          .validate('email', i18n.__('user.email'), {
            required: true
          })
          .validate('password', i18n.__('user.password'), {
            length: {
              min: 8,
              max: 15
            },
            required: true
          })
          .validate('confirmpassword', i18n.__('user.confirmPassword'), {
            length: {
              min: 8,
              max: 15
            },
            isConfirm: function(field, fieldName, value, fn) {
              var errors;
              if (value !== req.body.password) {
                errors = i18n.__('passNotConfirmed', fieldName, i18n.__('user.password'));
              }
              fn(errors);
            },
            required: true
          })
          .validate('agree-terms-1', i18n.__('user.agreeTerms1'), {
            required: true
          })
          .validate('agree-terms-2', i18n.__('user.agreeTerms2'), {
            required: true
          })
          .validate('agree-terms-3', i18n.__('user.agreeTerms3'), {
            required: true
          });

          req.Validator.getErrors(function(errors){
            if (errors.length > 0) {
              res.render('shipping', { errors: errors });
            }
            else {
              var user = new User({
                username: req.body.username,
                password: req.body.password,
                email: req.body.email,
                role: 'user',
                shipping: {
                  full_name: req.body.full_name,
                  address: req.body.address1,
                  country: req.body.country,
                  zipcode: req.body.zipcode,
                  phone_number: req.body.phone_number
                }
              });
              user.save(function(err) {
                if (err) {
                  res.render('shipping', { errors: err });
                }
                else {
                  order.user = user.id;
                  order.save(function(err) {
                    transporter.sendMail({
                      from: 'DailyBoom <contact@dailyboom.co>',
                      to: user.email,
                      subject: 'Welcome to DailyBoom',
                      text: 'Thank you for registering on DailyBoom!'
                    }, function (err, info) {
                        if (err) { console.log(err); res.render('shipping', { error: err.errmsg }); }
                        console.log('Message sent: ' + info.response);
                        transporter.close();
                        req.login(user, function(err) {
                          if (err) {
                            console.log(err);
                          }
                          return res.redirect('/checkout');
                        });
                    });
                  });
                }
              });
            }
          });
      }
      else if (req.user) {
        req.Validator.getErrors(function(errors){
          if (errors.length > 0) {
            res.render('shipping', { errors: errors });
          }
          else {
            var user = req.user;

            user.shipping = {
              full_name: req.body.full_name,
              address: req.body.address1,
              country: req.body.country,
              zipcode: req.body.zipcode,
              phone_number: req.body.phone_number
            }
            user.save(function(err) {
              if (err) {
                res.render('shipping', { errors: err });
              }
              else {
                order.user = user.id;
                order.save(function(err) {
                  if (err) {
                    res.render('shipping', { errors: err });
                  }
                  else {
                    res.redirect('/checkout');
                  }
                });
              }
            });
          }
        });
      }
      else {
        req.Validator.validate('email', i18n.__('user.email'), {
            required: true
        });

        req.Validator.getErrors(function(errors){
          if (errors.length > 0) {
            res.render('shipping', { errors: errors });
          }
          else {
            order.shipping = {
                full_name: req.body.full_name,
                address: req.body.address1,
                country: req.body.country,
                zipcode: req.body.zipcode,
                phone_number: req.body.phone_number
            }
            order.email = req.body.email;
            order.save(function(err) {
              if (err) {
                res.render('shipping', { errors: err });
              }
              else {
                  res.redirect('/checkout');
              }
            });
          }
        });
      }
  });
});

module.exports = router;
