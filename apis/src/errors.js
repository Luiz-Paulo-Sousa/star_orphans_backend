/** Erros */
let Errors = {
		/**
		 * Bad Request
		 * @param {object}  Express.Response
		 */
		badRequest:function(response)
		{response.status(400).json({message:"Bad Request",code:400});},
		
		/**
		 * Unauthorized
		 * @param {object}  Express.Response
		 */
		unauthorized: function(response)
		{response.status(401).json({message:"Unauthorized",code:401});},
		
		/**
		 * Forbidden
		 * @param {object}  Express.Response
		 */
		forbidden: function(response)
		{response.status(403).json({message:"Forbidden",code:403});},
		
		/**
		 * Not Found
		 * @param {object}  Express.Response
		 */
		notFound: function(response)
		{response.status(404).json({message:"Not Found",code:404});},
		
		/**
		 * Method Not Allowed
		 * @param {object}  Express.Response
		 */
		methodNotAllowed: function(response)
		{response.status(405).json({message:"Method Not Allowed",code:405});},
		
		
		/**
		 * Internal Server Error
		 * @param {object}  Express.Response
		 */
		internalServerError: function(response)
		{response.status(500).json({message:"Internal Server Error",code:500});},
		
		/**
		 * Not Implemented
		 * @param {object}  Express.Response
		 */
		notImplemented: function(response)
		{response.status(501).json({message:"Not Implemented",code:501});},
		
		/**
		 * Service Unavailable
		 * @param {object}  Express.Response
		 */
		serviceUnavailable: function(response)
		{response.status(503).json({message:"Service Unavailable",code:503});}
};

module.exports = Errors;