/** Variáveis de ambiente */
require('dotenv').config();

/** Requerimentos */
const JsonWebToken = require('jsonwebtoken');
const Request      = require('request');
const Express      = require('express');
const Helmet       = require('helmet');
const Http         = require('http');

const express      = Express();
const http         = Http.createServer(express);


// Middlewares
express.use(Express.json());
express.use(Helmet());


/**
 * Obtem um token de autenticação
 * @param {string} Nome da conta de usuario ou email
 * @param {string} Senha de acesso
 * @oaram {object} Resposta da solicitação http
*/
const getToken = function(account, password, response){
	// Parametros da requisição
	let xwsRequest = {
		url: 'https://starorphans.com/xws/auth/login',
		form: {account:account, pass:password},
		headers: {'APP': 'STAR-ORPHANS-GAME', 'content-type': 'application/x-www-form-urlencoded'},
		method: 'POST'
	};

	// Requisição de autenticação
	Request(xwsRequest, (err, xwsResponse, body) => {
		// Se não ouver erros
		if(!err && xwsResponse.statusCode == 200){
			var jsonObj = JSON.parse(body);
			getAccountData(jsonObj.token, response);
		}

		// Serviços de autenticação indisponível
		else response.status(503).json({
			message: "Service Unavailable",
			error: 503
		});
	});
};

/**
 * Usa um token para obter os dados da conta
 * @param {string} Token de acesso do usuario
 * @oaram {object} Resposta da solicitação http
 */
const getAccountData = function(token, response){
	// Parametros da requisição
	let xwsRequest = {
		url: 'http://starorphans.com/xws/account',
		headers: {'APP': 'STAR-ORPHANS-GAME', 'TOKEN': token, 'content-type': 'application/x-www-form-urlencoded'},
		method: 'POST'
	};

	// Requisição de autenticação
	Request(xwsRequest, (err, xwsResponse, body) => {
		// Se não ouver erros
		if(!err && xwsResponse.statusCode == 200){
			var jsonObj   = JSON.parse(body);
			jsonObj.token = token;

			const jwtToken = JsonWebToken.sign({uid:jsonObj.uid, name:jsonObj.gamer_tag}, process.env.SECRET_KEY, {algorithm:'HS512'});
			response.json({token:jwtToken});
			//response.json(jsonObj);
		}

		else resposne.status(503).json({
			message: "Service Unavailable",
			error: 503
		});
	});
};

express.get("/", (request, response) => {
	try {
		const {account, pass} = request.body;
		getToken("Zandrak", "Zandrak123", response);
	}

	catch(err){
		// Serviços de autenticação indisponível
		response.status(503).json({
			message: "Service Unavailable",
			error: 503
		});
	}
});


http.listen(8010, () => {
    console.log("Listening on " + 8010);
});